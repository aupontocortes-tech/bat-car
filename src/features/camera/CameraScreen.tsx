"use client";
import { useEffect, useRef, useState, useCallback } from 'react';
import Tesseract from 'tesseract.js';
import { extractPlates, normalizeText, type PlateRecord } from '../../utils/plate';
import { addPlateIfNew, getAllPlates, clearPlates, getCount } from '../storage/storage';
import { downloadExcel, makeExcelBlob } from '../export/excel';

export default function CameraScreen({ onBack }: { onBack: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [count, setCount] = useState<number>(0);
  const [showSaved, setShowSaved] = useState(false);
  const [savedRecords, setSavedRecords] = useState<PlateRecord[]>([]);

  const refreshCount = useCallback(async () => {
    setCount(await getCount());
  }, []);

  const processFrame = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    canvas.width = w;
    canvas.height = h;

    const cropW = Math.floor(w * 0.8);
    const cropH = Math.floor(h * 0.22);
    const x = Math.floor((w - cropW) / 2);
    const y = Math.floor((h - cropH) / 2);

    ctx.drawImage(video, 0, 0, w, h);
    const imageData = ctx.getImageData(x, y, cropW, cropH);
    const off = document.createElement('canvas');
    off.width = cropW;
    off.height = cropH;
    const octx = off.getContext('2d');
    if (!octx) return;
    octx.putImageData(imageData, 0, 0);

    try {
      const { data } = await Tesseract.recognize(off, 'eng', {
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      } as any);
      const raw = normalizeText(data.text || '');
      const maybePlate = extractPlate(raw);
      if (maybePlate) {
        const added = await addPlateIfNew(maybePlate);
        if (added) {
          triggerBeep();
          triggerVibrate();
          showMessage('Nova placa registrada!');
          refreshCount();
          const records = await getAllPlates();
          downloadExcel(records);
        } else {
          // Placa já existente: não salva novamente
          showMessage('Placa já registrada');
        }
      }
    } catch (err) {
      console.warn('OCR falhou', err);
    }
  }, [refreshCount]);

  useEffect(() => {
    let stream: MediaStream;
    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (videoRef.current) {
          videoRef.current.srcObject = stream as any;
          await videoRef.current.play();
        }
      } catch (err) {
        console.error('Erro ao acessar câmera', err);
        setMessage('Permita o acesso à câmera para continuar');
      }
    }
    startCamera();
    refreshCount();
    const id = setInterval(processFrame, 1800);
    return () => {
      clearInterval(id);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [processFrame, refreshCount]);

  function extractPlate(text: string): string | null {
    const candidates = extractPlates(text);
    return candidates.length > 0 ? candidates[0].toUpperCase() : null;
  }

  async function onExport() {
    const records = await getAllPlates();
    downloadExcel(records);
  }

  async function onShare() {
    const records = await getAllPlates();
    const blob = await makeExcelBlob(records);
    const file = new File([blob], 'placas_batapp.xlsx', { type: blob.type });
    if ((navigator as any).canShare && (navigator as any).canShare({ files: [file] })) {
      try {
        await (navigator as any).share({ files: [file], title: 'Placas Bat App' });
      } catch (e) {
        console.warn('Compartilhamento cancelado', e);
      }
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'placas_batapp.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  async function onClear() {
    await clearPlates();
    refreshCount();
    setSavedRecords([]);
  }

  async function openSavedList() {
    const list = await getAllPlates();
    setSavedRecords(list);
    setShowSaved(true);
  }

  function triggerBeep() {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      setTimeout(() => {
        o.stop();
        ctx.close();
      }, 120);
    } catch {}
  }

  function triggerVibrate() {
    if (navigator.vibrate) navigator.vibrate(80);
  }

  function showMessage(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(null), 1000);
  }

  return (
    <div className="relative w-full h-screen bg-black text-white">
      <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
      <canvas ref={canvasRef} className="hidden" />

      {/* Top overlay */}
      <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between text-sm">
        <button onClick={onBack} className="px-3 py-2 rounded bg-black/40 hover:bg.black/60">← Voltar</button>
        <div className="text-right">
          <div className="text-xs opacity-90">Aponte para a placa do veículo</div>
          <button
            onClick={openSavedList}
            className="mt-1 text-sm font-semibold underline underline-offset-2 hover:opacity-95"
            aria-label="Placas salvas"
            title="Placas salvas"
          >
            Placas salvas: {count}
          </button>
        </div>
        <button className="px-3 py-2 rounded bg-black/40 hover:bg.black/60">⚙️ Configurações</button>
      </div>

      {/* Focus rectangle */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[80%] h-[22%] border border-white/90 shadow-[0_0_0_2px_rgba(25,118,210,0.4)]" />
      </div>

      {/* Footer actions */}
      <div className="absolute bottom-0 left-0 right-0 bg-[#0D47A1]/70 backdrop-blur-sm p-3 flex items-center justify-around text-sm">
        <button onClick={onExport} className="px-3 py-2 rounded bg-white/10 hover:bg-white/20">📄 Exportar Excel</button>
        <button onClick={onShare} className="px-3 py-2 rounded bg.white/10 hover:bg.white/20">📤 Compartilhar</button>
        <button onClick={onClear} className="px-3 py-2 rounded bg.white/10 hover:bg.white/20">🗑 Apagar Registros</button>
      </div>

      {/* Toast message */}
      {message && (
        <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded shadow animate-pulse">
          ✅ {message}
        </div>
      )}

      {/* Saved plates modal */}
      {showSaved && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white text-black rounded-lg shadow-xl overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between border-b">
              <div className="font-semibold">Placas Salvas ({savedRecords.length})</div>
              <button
                onClick={() => setShowSaved(false)}
                className="px-2 py-1 rounded bg-black/10 hover:bg-black/20"
                aria-label="Fechar"
              >
                ✖
              </button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto">
              {savedRecords.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-black/60">Nenhum registro ainda</div>
              ) : (
                <ul>
                  {savedRecords.map((r) => (
                    <li key={r.plate} className="px-4 py-3 border-b text-sm flex items-center justify-between">
                      <span className="font-mono font-semibold">{r.plate}</span>
                      <span className="text-black/60">{new Date(r.timestamp).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="px-4 py-3 flex items-center justify-end gap-2 border-t bg-black/5">
              <button
                onClick={() => setShowSaved(false)}
                className="px-3 py-2 rounded bg-[#0D47A1] text-white hover:opacity-95"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}