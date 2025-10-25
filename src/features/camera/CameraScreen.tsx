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
  const lastDetectedRef = useRef<{ plate: string; confidence: number; ts: number } | null>(null);
  const cooldownMs = 4000; // evita repetição consecutiva em janelas curtas
  const minConfidence = 60; // confiança mínima para considerar leitura válida
  const confirmWindowMs = 2000; // janela (reduzida) apenas para reforço, não obrigatório

  // Worker Tesseract reutilizável para maior performance
  const workerRef = useRef<any>(null);
  const workerReadyRef = useRef<boolean>(false);

  // rAF + intervalo adaptativo com throttle 400–600ms
  const lastOCRAtRef = useRef<number>(0);
  const ocrIntervalMsRef = useRef<number>(380);
  const avgOcrMsRef = useRef<number>(380);
  // Controles de câmera: track, lanterna, zoom
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomSupported, setZoomSupported] = useState(false);
  const zoomRangeRef = useRef<{ min: number; max: number; step: number } | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  // Multi-ROI controle
  const roiBandRef = useRef<number>(1);
  const lastSuccessAtRef = useRef<number>(Date.now());
  // Toggle de exportação automática
  const [autoExport, setAutoExport] = useState<boolean>(true);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('autoExport');
      if (saved !== null) setAutoExport(saved === 'true');
    } catch {}
  }, []);
  // Modo diagnóstico: mostrar ROI e últimos dados de OCR
  const [debug, setDebug] = useState<boolean>(false);
  const [roiRect, setRoiRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [lastOcr, setLastOcr] = useState<{ text: string; confidence: number } | null>(null);
  const [fullFrame, setFullFrame] = useState<boolean>(false);
  const fullFrameRef = useRef<boolean>(false);

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

    // ROI central: faixa onde a placa costuma estar
    let cropW = Math.floor(w * 0.8);
    let cropH = Math.floor(h * 0.22);
    let baseX = Math.floor((w - cropW) / 2);
    // Alterna banda (topo/meio/base) se ficar >2s sem sucesso
    if (!fullFrameRef.current && Date.now() - lastSuccessAtRef.current > 2000) {
      roiBandRef.current = (roiBandRef.current + 1) % 3;
    }
    const middleY = Math.floor((h - cropH) / 2);
    const topY = Math.max(0, Math.floor(h * 0.18));
    const bottomY = Math.min(h - cropH, Math.floor(h * 0.62));
    let baseY = roiBandRef.current === 0 ? topY : roiBandRef.current === 2 ? bottomY : middleY;

    if (fullFrameRef.current) {
      cropW = w; cropH = h; baseX = 0; baseY = 0;
    }

    // Atualiza ROI para overlay/diagnóstico
    setRoiRect({ x: baseX, y: baseY, w: cropW, h: cropH });

    ctx.drawImage(video, 0, 0, w, h);

    try {
      let maybePlate: string | null = null;
      let gotConfidence = 0;

      const t0 = performance.now();
      // Processa apenas a ROI central por frame
      const scale = avgOcrMsRef.current > 700 ? 1.1 : avgOcrMsRef.current > 500 ? 1.2 : 1.5;
      const off = document.createElement('canvas');
      off.width = Math.floor(cropW * scale);
      off.height = Math.floor(cropH * scale);
      const octx = off.getContext('2d');
      if (octx) {
        octx.imageSmoothingEnabled = true;
        octx.drawImage(canvas, baseX, baseY, cropW, cropH, 0, 0, off.width, off.height);

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
        const conf = typeof (data as any).confidence === 'number' ? (data as any).confidence : 80;
        // Atualiza últimos dados de OCR para diagnóstico
        setLastOcr({ text: data.text || '', confidence: conf });
        if (candidate) {
          maybePlate = candidate;
          gotConfidence = conf;
        }
      }
      const dt = performance.now() - t0;
      // atualiza média móvel e ajusta intervalo alvo (clamp 300–450ms)
      avgOcrMsRef.current = 0.8 * avgOcrMsRef.current + 0.2 * dt;
      ocrIntervalMsRef.current = Math.max(300, Math.min(450, avgOcrMsRef.current));

      if (maybePlate) {
        const now = Date.now();
        const prev = lastDetectedRef.current;
        const currentValid = gotConfidence >= minConfidence;
        const consecutiveTwo = !!prev && prev.plate === maybePlate && (now - prev.ts <= confirmWindowMs) && currentValid && prev.confidence >= minConfidence;

        if (lastPlateRef.current === maybePlate && now - lastSeenAtRef.current < cooldownMs) {
          showMessage('Placa já registrada');
        } else if (currentValid) {
          // confirma em 1 frame com confiança e salva em paralelo
          lastPlateRef.current = maybePlate;
          lastSeenAtRef.current = now;
          lastSuccessAtRef.current = now;
          roiBandRef.current = 1; // volta para banda central
          (async () => {
            const added = await addPlateIfNew(maybePlate!);
            if (added) {
              triggerBeep();
              triggerVibrate();
              showMessage('Nova placa registrada!');
              refreshCount();
              const records = await getAllPlates();
              if (autoExport) downloadExcel(records);
            } else {
              showMessage('Placa já registrada');
            }
          })();
          lastDetectedRef.current = null;
        } else {
          // guarda leitura atual para possível reforço no próximo frame
          lastDetectedRef.current = { plate: maybePlate, confidence: gotConfidence, ts: now };
        }
      } else {
        // sem leitura válida neste frame; não altera lastDetectedRef
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
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream as any;
          await videoRef.current.play();
        }
        // Detecção de capacidades (torch/zoom)
        const track = stream.getVideoTracks()[0];
        videoTrackRef.current = track;
        const caps: any = track.getCapabilities ? track.getCapabilities() : {};
        if (caps && 'torch' in caps) setTorchSupported(!!caps.torch);
        const zoomCap = caps?.zoom;
        if (typeof zoomCap === 'object' && typeof zoomCap.min === 'number') {
          setZoomSupported(true);
          zoomRangeRef.current = { min: zoomCap.min ?? 1, max: zoomCap.max ?? 3, step: zoomCap.step ?? 0.1 };
          const initial = zoomCap.min ?? 1;
          setZoom(initial);
          try { await track.applyConstraints({ advanced: [{ zoom: initial }] }); } catch {}
        } else if (typeof zoomCap === 'number') {
          setZoomSupported(true);
          zoomRangeRef.current = { min: 1, max: zoomCap, step: 0.1 };
          const initial = 1;
          setZoom(initial);
          try { await track.applyConstraints({ advanced: [{ zoom: initial }] }); } catch {}
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

    // solicita armazenamento persistente (offline mais confiável)
    (navigator as any).storage?.persist?.().catch(() => {});

    // Loop rAF com throttle por intervalo adaptativo
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

  async function setTorch(next: boolean) {
    const track = videoTrackRef.current;
    if (!track || !torchSupported) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as any);
      setTorchOn(next);
    } catch (e) { console.warn('Torch não disponível', e); }
  }

  async function setZoomValue(val: number) {
    const track = videoTrackRef.current;
    if (!track || !zoomSupported) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: val }] } as any);
      setZoom(val);
    } catch (e) { console.warn('Zoom não disponível', e); }
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
        <label className="flex items-center gap-2 px-3 py-2 rounded bg.white/10">
          <input type="checkbox" checked={autoExport} onChange={(e) => { const v = e.target.checked; setAutoExport(v); try { localStorage.setItem('autoExport', String(v)); } catch {} }} />
          <span>Exportação automática</span>
        </label>
        {torchSupported && (
          <button onClick={() => setTorch(!torchOn)} className="px-3 py-2 rounded bg.white/10 hover:bg.white/20" aria-pressed={torchOn}>
            {torchOn ? '🔦 Lanterna ON' : '🔦 Lanterna OFF'}
          </button>
        )}
        {zoomSupported && (
          <div className="flex items-center gap-2 px-3 py-2 rounded bg.white/10">
            <span>🔍 Zoom</span>
            <input type="range" min={zoomRangeRef.current?.min ?? 1} max={zoomRangeRef.current?.max ?? 3} step={zoomRangeRef.current?.step ?? 0.1} value={zoom ?? (zoomRangeRef.current?.min ?? 1)} onChange={(e) => setZoomValue(parseFloat(e.target.value))} />
          </div>
        )}
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

  // Grayscale
  let sum = 0;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    d[i] = d[i + 1] = d[i + 2] = gray;
    sum += gray;
    if (gray < min) min = gray;
    if (gray > max) max = gray;
  }
  const mean = sum / (w * h);

  // Auto contraste (stretch min/max)
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    let val = ((d[i] - min) * 255) / range;
    d[i] = d[i + 1] = d[i + 2] = val;
  }

  // Gamma simples baseado na média (ajuste leve sol/sombra)
  const gamma = mean < 100 ? 0.9 : mean > 160 ? 1.1 : 1.0;
  for (let i = 0; i < d.length; i += 4) {
    let v = d[i] / 255;
    v = Math.pow(v, gamma);
    const val = Math.max(0, Math.min(255, Math.round(v * 255)));
    d[i] = d[i + 1] = d[i + 2] = val;
  }

  // Threshold adaptativo simples (baseado em nova média)
  let sum2 = 0;
  for (let i = 0; i < d.length; i += 4) sum2 += d[i];
  const mean2 = sum2 / (w * h);
  const threshold = Math.max(100, Math.min(200, mean2 * 0.95));
  for (let i = 0; i < d.length; i += 4) {
    const val = d[i] > threshold ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = val;
    d[i + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return out;
}