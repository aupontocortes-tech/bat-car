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

  // Controle de processamento e dedupe temporal
  const processingRef = useRef(false);
  const lastPlateRef = useRef<string | null>(null);
  const lastSeenAtRef = useRef<number>(0);
  const cooldownMs = 5000; // evita repetição consecutiva em janelas curtas
  const minConfidence = 70; // confiança mínima para registrar

  // Worker Tesseract reutilizável para maior performance
  const workerRef = useRef<any>(null);
  const workerReadyRef = useRef<boolean>(false);

  // Buffer de detecções recentes para confirmação multi-frame
  const recentDetectionsRef = useRef<Array<{ plate: string; confidence: number; ts: number }>>([]);
  const confirmWindowMs = 3000; // janela para confirmar mesma placa
  const minRepeats = 2; // mínimo de aparições para confirmar

  // rAF + intervalo adaptativo para maior fluidez
  const lastOCRAtRef = useRef<number>(0);
  const ocrIntervalMsRef = useRef<number>(300); // alvo de ~300ms
  const avgOcrMsRef = useRef<number>(350); // média móvel do tempo de OCR
  const refreshCount = useCallback(async () => {
    setCount(await getCount());
  }, []);

  const processFrame = useCallback(async () => {
    if (processingRef.current) return;
    if (!videoRef.current || !canvasRef.current) return;
    processingRef.current = true;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) { processingRef.current = false; return; }

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) { processingRef.current = false; return; }
    canvas.width = w;
    canvas.height = h;

    const cropW = Math.floor(w * 0.8);
    const cropH = Math.floor(h * 0.22);
    const baseX = Math.floor((w - cropW) / 2);
    const baseY = Math.floor((h - cropH) / 2);
    const offsetY = Math.floor(h * 0.06);

    ctx.drawImage(video, 0, 0, w, h);


    // ROIs dinâmicos: reduza custo quando estiver lento
    const slow = avgOcrMsRef.current > 400; // reduza custo mais cedo
    const verySlow = avgOcrMsRef.current > 800; // custo mínimo quando muito lento
    const rois = verySlow
      ? [{ x: baseX, y: baseY }]
      : slow
      ? [
          { x: baseX, y: baseY },
          { x: baseX, y: Math.max(0, baseY - offsetY) },
        ]
      : [
          { x: baseX, y: baseY },
          { x: baseX, y: Math.max(0, baseY - offsetY) },
          { x: baseX, y: Math.min(h - cropH, baseY + offsetY) },
        ];

    try {
      let maybePlate: string | null = null;
      let gotConfidence = 0;

      const t0 = performance.now();
      for (const roi of rois) {
        const scale = verySlow ? 1.1 : slow ? 1.2 : 1.5; // ajuste dinâmico de escala
        const off = document.createElement('canvas');
        off.width = Math.floor(cropW * scale);
        off.height = Math.floor(cropH * scale);
        const octx = off.getContext('2d');
        if (!octx) continue;
        octx.imageSmoothingEnabled = true;
        octx.drawImage(canvas, roi.x, roi.y, cropW, cropH, 0, 0, off.width, off.height);
 
           const proc = preprocessCanvas(off);
 
           let data: any;
           if (workerReadyRef.current && workerRef.current) {
             const result = await workerRef.current.recognize(proc);
             data = result.data;
           } else {
             const result = await Tesseract.recognize(proc, 'eng', {
               tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
               psm: 7,
             } as any);
             data = result.data;
           }
 
           const raw = normalizeText(data.text || '');
           const candidate = extractPlate(raw);
-          const conf = (data.confidence as number) || 0;
+          const conf = typeof (data as any).confidence === 'number' ? (data as any).confidence : 80;
           if (candidate) {
             maybePlate = candidate;
             gotConfidence = conf;
             break;
           }

        }
        const dt = performance.now() - t0;
        // atualiza média móvel e ajusta intervalo alvo
        avgOcrMsRef.current = 0.7 * avgOcrMsRef.current + 0.3 * dt;
        ocrIntervalMsRef.current = Math.max(150, Math.min(500, avgOcrMsRef.current * 0.7));

      if (maybePlate) {
        const now = Date.now();
        // Atualiza buffer e verifica repetição
        recentDetectionsRef.current = recentDetectionsRef.current
          .filter((d) => now - d.ts <= confirmWindowMs)
          .concat({ plate: maybePlate, confidence: gotConfidence, ts: now });
        -        const repeats = recentDetectionsRef.current.filter((d) => d.plate === maybePlate && (d.confidence === undefined || d.confidence >= minConfidence)).length;
        +        const repeats = recentDetectionsRef.current.filter((d) => d.plate === maybePlate && (d.confidence === undefined || d.confidence >= minConfidence)).length;
        +        const shouldConfirm = repeats >= minRepeats || gotConfidence >= (minConfidence + 15);
        
        if (lastPlateRef.current === maybePlate && now - lastSeenAtRef.current < cooldownMs) {
          showMessage('Placa já registrada');
        -        } else if (repeats >= minRepeats) {
        +        } else if (shouldConfirm) {
          lastPlateRef.current = maybePlate;
          lastSeenAtRef.current = now;
          const added = await addPlateIfNew(maybePlate);
          if (added) {
            triggerBeep();
            triggerVibrate();
            showMessage('Nova placa registrada!');
            refreshCount();
            const records = await getAllPlates();
            downloadExcel(records);
          } else {
            showMessage('Placa já registrada');
          }
        } else {
          // Ainda não confirmou em múltiplos frames
        }
      }
    } catch (err) {
      console.warn('OCR falhou', err);
    } finally {
      processingRef.current = false;
    }
  }, [refreshCount]);

  useEffect(() => {
    let stream: MediaStream;
    let animId = 0;
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
    async function initWorker() {
      try {
        const worker = await (Tesseract as any).createWorker({ logger: null });
        await worker.loadLanguage('eng');
        await worker.initialize('eng');
        await worker.setParameters({
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
          psm: '7',
        });
        workerRef.current = worker;
        workerReadyRef.current = true;
      } catch (e) {
        console.warn('Falha ao iniciar worker Tesseract', e);
        workerReadyRef.current = false;
      }
    }
    startCamera();
    initWorker();
    refreshCount();
    // Loop com requestAnimationFrame, aplicando intervalo adaptativo
    const tick = async () => {
    const now = performance.now();
    if (!processingRef.current && now - lastOCRAtRef.current >= ocrIntervalMsRef.current) {
    await processFrame();
    lastOCRAtRef.current = now;
    }
    animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => {
    cancelAnimationFrame(animId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      const w = workerRef.current;
      if (w && w.terminate) {
        try { w.terminate(); } catch {}
        workerRef.current = null;
        workerReadyRef.current = false;
      }
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


function preprocessCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
    const w = src.width;
    const h = src.height;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    if (!ctx) return src;
    ctx.drawImage(src, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    // Grayscale + threshold adaptativo simples (baseado na média)
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      d[i] = d[i + 1] = d[i + 2] = gray;
      sum += gray;
    }
    const mean = sum / (w * h);
    const threshold = Math.max(100, Math.min(200, mean * 0.95));
    for (let i = 0; i < d.length; i += 4) {
      const val = d[i] > threshold ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = val;
      d[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    return out;
  }