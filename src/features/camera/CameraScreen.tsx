"use client";
import { useEffect, useRef, useState, useCallback } from 'react';
import Tesseract from 'tesseract.js';
import { extractPlatesStrict, normalizeText, isValidPlate, type PlateRecord } from '../../utils/plate';
import { addPlateIfNew, getAllPlates, clearPlates, getCount } from '../storage/storage';
import { downloadExcel, makeExcelBlob } from '../export/excel';

export default function CameraScreen({ onBack }: { onBack: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [count, setCount] = useState<number>(0);
  const [showSaved, setShowSaved] = useState(false);
  const [savedRecords, setSavedRecords] = useState<PlateRecord[]>([]);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  // Controle de processamento e dedupe temporal
  const processingRef = useRef(false);
  const lastPlateRef = useRef<string | null>(null);
  const lastSeenAtRef = useRef<number>(0);
  const lastDetectedRef = useRef<{ plate: string; confidence: number; ts: number } | null>(null);
  const stableRef = useRef<{ plate: string; count: number; firstTs: number; lastTs: number; lastConf: number } | null>(null);
  const cooldownMs = 5000; // janela maior para evitar repetição consecutiva
  const minConfidence = 80; // confiança mínima mais alta para reduzir falsas leituras
  const confirmWindowMs = 1600; // janela levemente maior para reforço
  // Set de placas já conhecidas (IndexedDB) para evitar repetir eventos
  const knownPlatesRef = useRef<Set<string>>(new Set());
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomSupported, setZoomSupported] = useState(false);
  const zoomRangeRef = useRef<{ min: number; max: number; step: number } | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  // Multi-ROI controle
  const roiBandRef = useRef<number>(1);
  const lastSuccessAtRef = useRef<number>(Date.now());
  // Exportação manual apenas (sem auto-export)
  const lastExportAtRef = useRef<number>(0);
  const lockUntilRef = useRef<number>(0); // bloqueia novas placas por alguns segundos após registrar
  // Sem inicialização de autoExport: leitura de placa NÃO dispara download
  // Modo diagnóstico: mostrar ROI e últimos dados de OCR
  const [debug, setDebug] = useState<boolean>(false);
  const [roiRect, setRoiRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [lastOcr, setLastOcr] = useState<{ text: string; confidence: number } | null>(null);
  const [fullFrame, setFullFrame] = useState<boolean>(false);
  const fullFrameRef = useRef<boolean>(false);

  // Refs de OCR/worker e controle de intervalo
  const workerRef = useRef<any>(null);
  const workerReadyRef = useRef<boolean>(false);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const avgOcrMsRef = useRef<number>(500);
  const ocrIntervalMsRef = useRef<number>(350);
  const lastOCRAtRef = useRef<number>(0);
  // Captura de erros para diagnóstico rápido
  const [lastError, setLastError] = useState<string | null>(null);

  // Reconhecimento seguro: tenta WebWorker; em caso de falha, desativa worker e faz fallback no main thread
  async function safeRecognize(canvasEl: HTMLCanvasElement, psm: number | string) {
    // garante tipo numérico para parâmetros sensíveis
    const psmNum = typeof psm === 'string' ? Number(psm) : psm;
    try {
      if (workerReadyRef.current && workerRef.current) {
        try {
          await workerRef.current.setParameters({
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
            preserve_interword_spaces: '1',
            user_defined_dpi: '300',
            psm: psmNum,
            load_system_dawg: 0,
            load_freq_dawg: 0,
          });
        } catch (e) {
          console.warn('[OCR] setParameters falhou; desativando worker e usando fallback', e);
          try { workerRef.current?.terminate?.(); } catch {}
          workerRef.current = null;
          workerReadyRef.current = false;
        }

        if (workerReadyRef.current && workerRef.current) {
          const result = await workerRef.current.recognize(canvasEl);
          return result;
        }
      }
    } catch (err) {
      console.warn('[OCR] recognize via worker falhou; fallback no main thread', err);
      try { workerRef.current?.terminate?.(); } catch {}
      workerRef.current = null;
      workerReadyRef.current = false;
    }
    // Fallback robusto no main thread
    const result = await Tesseract.recognize(canvasEl, 'eng', {
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
      psm: psmNum,
      load_system_dawg: 0,
      load_freq_dawg: 0,
    } as any);
    return result;
  }

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

    // ROI central: faixa focada para capturar apenas a placa apontada
    let cropW = Math.floor(w * 0.72);
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

    // Desabilita fallback de frame completo para evitar texto fora da placa
    const useFull = false;

    // Atualiza ROI para overlay/diagnóstico
    setRoiRect({ x: baseX, y: baseY, w: cropW, h: cropH });

    ctx.drawImage(video, 0, 0, w, h);

    try {
      let maybePlate: string | null = null;
      let gotConfidence = 0;

      const t0 = performance.now();
      // Processa ROI com escala moderada para foco na placa central
      const scale = 1.6;
      const off = document.createElement('canvas');
      off.width = Math.floor(cropW * scale);
      off.height = Math.floor(cropH * scale);
      const octx = off.getContext('2d');
      if (octx) {
        octx.imageSmoothingEnabled = true;
        octx.drawImage(canvas, baseX, baseY, cropW, cropH, 0, 0, off.width, off.height);

        const proc = preprocessCanvas(off);

        let data: any;
        const chosenPsm = choosePsm(proc);
        const result = await safeRecognize(proc, chosenPsm);
        data = result?.data;
        const primaryText = pickCentralText(data, off.width, off.height) || '';
        const raw = normalizeText(primaryText);
        const candidates = extractPlatesStrict(raw, 1);
        const candidate = candidates.length > 0 ? candidates[0] : null;
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
        const isFormatOK = isValidPlate(maybePlate!);
        // Atualiza contagem estável de frames consecutivos com a mesma placa
        const st = stableRef.current;
        if (st && st.plate === maybePlate) {
          stableRef.current = { plate: st.plate, count: st.count + 1, firstTs: st.firstTs, lastTs: now, lastConf: gotConfidence };
        } else {
          stableRef.current = { plate: maybePlate!, count: 1, firstTs: now, lastTs: now, lastConf: gotConfidence };
        }
        const stable = stableRef.current!;

        // Bloqueio: se acabamos de registrar uma placa, ignore diferentes enquanto bloqueado
        if (lockUntilRef.current > now && lastPlateRef.current && maybePlate !== lastPlateRef.current) {
          // ignora leituras de placas diferentes durante bloqueio
          lastDetectedRef.current = null;
          processingRef.current = false;
          return;
        }

        if (lastPlateRef.current === maybePlate && now - lastSeenAtRef.current < cooldownMs) {
          showMessage('Placa já registrada');
        } else if (stable.count >= 3 && stable.lastConf >= minConfidence && isFormatOK && (stable.lastTs - stable.firstTs) <= 2500) {
          // confirma somente com 3 frames consecutivos válidos dentro de ~2.5s
          lastPlateRef.current = maybePlate;
          lastSeenAtRef.current = now;
          lastSuccessAtRef.current = now;
          roiBandRef.current = 1; // volta para banda central
          (async () => {
            const added = await addPlateIfNew(maybePlate!);
            if (added) {
              knownPlatesRef.current.add(maybePlate!);
              sendPlate(maybePlate!);
              triggerBeep();
              triggerVibrate();
              showMessage('Nova placa registrada!');
              refreshCount();
              lockUntilRef.current = now + 5000; // trava leitura de outras placas por 5s
              stableRef.current = null; // reseta contagem estável após registrar
              // NENHUM download automático de Excel após ler placa
              // Exportação continua disponível apenas nos botões "Exportar/Compartilhar"
            } else {
              showMessage('Placa já registrada');
            }
          })();
          lastDetectedRef.current = null;
        } else {
          // guarda leitura atual para possível reforço no próximo frame
          lastDetectedRef.current = { plate: maybePlate, confidence: gotConfidence, ts: now };
          // não emite evento para leituras não confirmadas
        }
      } else {
        // sem leitura válida neste frame; não altera lastDetectedRef
        stableRef.current = null; // reseta estabilidade
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
        // Substitui getUserMedia direto por fallback multi-tentativa
        stream = await getCameraStreamWithFallback();
        if (videoRef.current) {
          const v = videoRef.current;
          // Evita reatribuir se já estiver com o mesmo stream
          if (v.srcObject !== stream) v.srcObject = stream as any;
          // Aguarda metadados antes de chamar play()
          await new Promise<void>((resolve) => {
            if (v.readyState >= 1) resolve();
            else v.onloadedmetadata = () => resolve();
          });
          try {
            await v.play();
          } catch (e: any) {
            // AbortError: uma nova requisição de load interrompeu play()
            if (e?.name === 'AbortError') {
              console.warn('play() abortada; tentando novamente...');
              setTimeout(() => {
                v.play().catch(() => {});
              }, 50);
            } else {
              console.warn('Falha ao iniciar reprodução do vídeo', e);
            }
          }
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
          try { await track.applyConstraints({ advanced: [{ zoom: initial } as any] }); } catch {}
        } else if (typeof zoomCap === 'number') {
          setZoomSupported(true);
          zoomRangeRef.current = { min: 1, max: zoomCap, step: 0.1 };
          const initial = 1;
          setZoom(initial);
          try { await track.applyConstraints({ advanced: [{ zoom: initial } as any] }); } catch {}
        }
      } catch (err) {
        console.warn('Erro ao acessar câmera', err);
        const e: any = err;
        if (e?.name === 'NotReadableError') {
          // Dispositivo em uso: tenta encerrar qualquer stream anterior e refazer a requisição
          setMessage('Câmera em uso por outro app. Feche outras abas e aguarde...');
          try {
            const prev = (videoRef.current?.srcObject as MediaStream) || null;
            prev?.getTracks()?.forEach((t) => t.stop());
            if (videoRef.current) (videoRef.current as any).srcObject = null;
          } catch {}
          setTimeout(async () => {
            try {
              const retry = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false,
              });
              if (videoRef.current) {
                const v = videoRef.current;
                if (v.srcObject !== retry) v.srcObject = retry as any;
                await new Promise<void>((resolve) => {
                  if (v.readyState >= 1) resolve();
                  else v.onloadedmetadata = () => resolve();
                });
                try { await v.play(); } catch {}
              }
              stream = retry;
              const track = retry.getVideoTracks()[0];
              videoTrackRef.current = track;
              const caps: any = track.getCapabilities ? track.getCapabilities() : {};
              if (caps && 'torch' in caps) setTorchSupported(!!caps.torch);
              const zoomCap = caps?.zoom;
              if (typeof zoomCap === 'object' && typeof zoomCap.min === 'number') {
                setZoomSupported(true);
                zoomRangeRef.current = { min: zoomCap.min ?? 1, max: zoomCap.max ?? 3, step: zoomCap.step ?? 0.1 };
                const initial = zoomCap.min ?? 1;
                setZoom(initial);
                try { await track.applyConstraints({ advanced: [{ zoom: initial } as any] }); } catch {}
              } else if (typeof zoomCap === 'number') {
                setZoomSupported(true);
                zoomRangeRef.current = { min: 1, max: zoomCap, step: 0.1 };
                const initial = 1;
                setZoom(initial);
                try { await track.applyConstraints({ advanced: [{ zoom: initial } as any] }); } catch {}
              }
              showMessage('Câmera iniciada');
            } catch (e2) {
              console.warn('Retry de acesso à câmera falhou', e2);
               setMessage('Não foi possível iniciar a câmera. Feche apps que usam a câmera.');
             }
          }, 250);
        } else {
          setMessage('Permita o acesso à câmera para continuar');
        }
      }
    }

    async function initWorker() {
      try {
        const useWorker = String(process.env.NEXT_PUBLIC_OCR_WORKER) === 'true';
        if (!useWorker) {
          // Em desenvolvimento, manter fallback no main thread para maior estabilidade
          workerRef.current = null;
          workerReadyRef.current = false;
          console.info('[OCR] WebWorker desativado por configuração; usando main thread');
          return;
        }

        const { createWorker } = await import('tesseract.js');
        const isDev = process.env.NODE_ENV !== 'production';
        const createWorkerAny: any = createWorker;
        workerRef.current = await createWorkerAny({
          logger: isDev ? ((m: any) => console.log(m)) : undefined,
        });
        await workerRef.current.load();
        await workerRef.current.loadLanguage('eng');
        await workerRef.current.initialize('eng');
        // Define parâmetros com tipos numéricos para maior compatibilidade no worker
        await workerRef.current.setParameters({
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
          psm: 7,
          load_system_dawg: 0,
          load_freq_dawg: 0,
          tessedit_pageseg_mode: 7,
          classify_bln_numeric_mode: 0,
        });
        workerReadyRef.current = true;
        // Verificação inicial leve para detectar erros precoces no worker
        try {
          const testCanvas = document.createElement('canvas');
          testCanvas.width = 8; testCanvas.height = 8;
          await workerRef.current.recognize(testCanvas);
        } catch (e) {
          console.warn('[OCR] Verificação inicial do worker falhou; desativando e usando fallback', e);
          try { workerRef.current?.terminate?.(); } catch {}
          workerRef.current = null;
          workerReadyRef.current = false;
        }
         console.info('[OCR] WebWorker habilitado em produção');
      } catch (e) {
        console.warn('Falha ao inicializar OCR Worker; usando main thread', e);
        workerRef.current = null;
        workerReadyRef.current = false;
      }
    }
    startCamera();
    initWorker();
    refreshCount();

    // Carrela placas já conhecidas do IndexedDB para dedupe de eventos
    getAllPlates()
      .then((list) => {
        try {
          const arr = Array.isArray(list) ? list : [];
          knownPlatesRef.current = new Set(arr.map((r) => r.plate));
        } catch {}
      })
      .catch(() => {});

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
    const candidates = extractPlatesStrict(text, 2);
    return candidates.length > 0 ? candidates[0].toUpperCase() : null;
  }

  async function onExport() {
    try {
      const records = await getAllPlates();
      const safe = Array.isArray(records) ? records.filter(Boolean) : [];
      downloadExcel(safe);
    } catch (e) {
      console.warn('Export falhou', e);
      const err: any = e;
      setLastError(`Export falhou: ${err?.message || String(err)}${err?.stack ? `\n${err.stack}` : ''}`);
    }
  }

  async function onShare() {
    try {
      const records = await getAllPlates();
      const safe = Array.isArray(records) ? records.filter(Boolean) : [];
      const blob = await makeExcelBlob(safe);
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
    } catch (e) {
      console.warn('Share falhou', e);
      const err: any = e;
      setLastError(`Share falhou: ${err?.message || String(err)}${err?.stack ? `\n${err.stack}` : ''}`);
    }
  }

  async function onClear() {
    await clearPlates();
    refreshCount();
    setSavedRecords([]);
    try { knownPlatesRef.current.clear(); } catch {}
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

  // moved inside component to access setLastEvent
  // sendPlate foi movida para dentro do componente para acessar setLastEvent
  function sendPlate(plate: string) {
    const payload = { placa: plate, data_hora: formatDateTime() };
    setLastEvent(JSON.stringify(payload));
    try {
      window.dispatchEvent(new CustomEvent('batapp:plate', { detail: payload }));
    } catch {}
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
        <button onClick={onBack} className="px-3 py-2 rounded bg-black/40 hover:bg-black/60">← Voltar</button>
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
        <div className="w-[85%] h-[30%] border border-white/90 shadow-[0_0_0_2px_rgba(25,118,210,0.4)]" />
      </div>

      {/* Footer actions */}
      <div className="absolute bottom-0 left-0 right-0 bg-[#0D47A1]/70 backdrop-blur-sm p-3 flex items-center justify-around text-sm">
        <button onClick={onExport} className="px-3 py-2 rounded bg-white/10 hover:bg-white/20">📄 Exportar Excel</button>
        <button onClick={onShare} className="px-3 py-2 rounded bg-white/10 hover:bg-white/20">📤 Compartilhar</button>
        <button onClick={onClear} className="px-3 py-2 rounded bg.white/10 hover:bg.white/20">🗑 Apagar Registros</button>
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
              {(Array.isArray(savedRecords) ? savedRecords.length === 0 : true) ? (
                <div className="px-4 py-6 text-center text-sm text-black/60">Nenhum registro ainda</div>
              ) : (
                <ul>
                  {(Array.isArray(savedRecords) ? savedRecords : []).map((r) => (
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
      {/* Overlay de erro para diagnóstico rápido */}
      {lastError && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-2xl bg-white text-black rounded-lg shadow-xl overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between border-b">
              <div className="font-semibold text-red-700">Erro de execução</div>
              <button
                onClick={() => setLastError(null)}
                className="px-2 py-1 rounded bg-black/10 hover:bg-black/20"
                aria-label="Fechar"
              >
                ✖
              </button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto">
              <pre className="px-4 py-3 text-xs whitespace-pre-wrap break-words">{String(lastError)}</pre>
            </div>
            <div className="px-4 py-3 flex items-center justify-end gap-2 border-t bg-black/5">
              <button
                onClick={() => { try { navigator.clipboard.writeText(String(lastError)); } catch {} }}
                className="px-3 py-2 rounded bg-[#0D47A1] text-white hover:opacity-95"
              >
                Copiar
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

  // Threshold adaptativo otimizado para placas brasileiras
  let sum2 = 0;
  for (let i = 0; i < d.length; i += 4) sum2 += d[i];
  const mean2 = sum2 / (w * h);
  const threshold = Math.max(90, Math.min(180, mean2 * 0.92));
  for (let i = 0; i < d.length; i += 4) {
    const val = d[i] > threshold ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = val;
    d[i + 3] = 255;
  }

  // Dilatação (conecta traços finos)
  const dil = new Uint8ClampedArray(d.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let isBlack = false;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const xi = Math.max(0, Math.min(w - 1, x + kx));
          const yi = Math.max(0, Math.min(h - 1, y + ky));
          const idx = (yi * w + xi) * 4;
          if (d[idx] === 0) { isBlack = true; break; }
        }
        if (isBlack) break;
      }
      const idx2 = (y * w + x) * 4;
      const val2 = isBlack ? 0 : 255;
      dil[idx2] = dil[idx2 + 1] = dil[idx2 + 2] = val2;
      dil[idx2 + 3] = 255;
    }
  }
  for (let i = 0; i < d.length; i += 4) {
    d[i] = dil[i]; d[i + 1] = dil[i + 1]; d[i + 2] = dil[i + 2]; d[i + 3] = 255;
  }

  // Sharpen leve (unsharp mask)
  const blur = new Uint8ClampedArray(d.length);
  const kernel = [1/9,1/9,1/9,1/9,1/9,1/9,1/9,1/9,1/9];
  const get = (x:number,y:number)=>{
    const xi = Math.max(0, Math.min(w-1, x));
    const yi = Math.max(0, Math.min(h-1, y));
    const idx = (yi*w+xi)*4; return d[idx];
  };
  for (let y=0;y<h;y++){
    for (let x=0;x<w;x++){
      let acc=0; let k=0;
      for (let ky=-1;ky<=1;ky++){
        for (let kx=-1;kx<=1;kx++){
          acc += get(x+kx,y+ky)*kernel[k++];
        }
      }
      const idx=(y*w+x)*4; const orig=d[idx];
      const val = Math.max(0, Math.min(255, Math.round(orig + 0.6*(orig - acc))));
      blur[idx]=blur[idx+1]=blur[idx+2]=val; blur[idx+3]=255;
    }
  }
  for (let i=0;i<d.length;i+=4){
    d[i]=blur[i]; d[i+1]=blur[i+1]; d[i+2]=blur[i+2]; d[i+3]=255;
  }

  ctx.putImageData(imageData, 0, 0);
  return out;
}



function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function getCameraStreamWithFallback(): Promise<MediaStream> {
  const base: MediaStreamConstraints = {
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  } as any;
  try {
    return await navigator.mediaDevices.getUserMedia(base);
  } catch (e: any) {
    // Tentar câmera frontal como fallback
    if (e?.name === 'NotReadableError' || e?.name === 'OverconstrainedError' || e?.name === 'AbortError') {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'user' } }, audio: false } as any);
        return s;
      } catch {}
      // Enumerar devices e tentar por deviceId
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videos = devices.filter((d) => d.kind === 'videoinput');
        for (const d of videos) {
          await sleep(150);
          try {
            const s = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: d.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } },
              audio: false,
            } as any);
            return s;
          } catch {}
        }
      } catch {}
    }
    throw e;
  }
}


// Estima fração de pixels pretos (texto) na imagem binária (amostragem por passo)
function estimateBlackFraction(src: HTMLCanvasElement, step = 8): number {
  const ctx = src.getContext('2d');
  if (!ctx) return 0.1;
  const { width: w, height: h } = src;
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  let total = 0;
  let black = 0;
  const stride = step * 4;
  for (let y = 0; y < h; y += step) {
    const rowStart = y * w * 4;
    for (let x = 0; x < w; x += step) {
      const i = rowStart + x * 4;
      const v = d[i];
      // 0 = preto (texto), 255 = branco (fundo), conforme preprocessCanvas
      if (v === 0) black++;
      total++;
    }
  }
  if (total === 0) return 0.1;
  return black / total;
}

// Escolhe PSM otimizado para placas brasileiras baseado na análise da imagem
function choosePsm(src: HTMLCanvasElement): '6' | '7' | '8' {
  const blackFraction = estimateBlackFraction(src, 6);
  const ctx = src.getContext('2d');
  if (!ctx) return '7';
  
  const { width: w, height: h } = src;
  const aspectRatio = w / h;
  
  // PSM 6: Bloco uniforme de texto (ideal para placas bem enquadradas)
  // PSM 7: Linha única de texto (padrão para placas)  
  // PSM 8: Palavra única (para placas com espaçamento irregular)
  
  if (aspectRatio > 3.5 && blackFraction > 0.15 && blackFraction < 0.4) {
    return '6'; // Placa bem enquadrada horizontalmente
  } else if (blackFraction > 0.08 && blackFraction < 0.25) {
    return '7'; // Linha única padrão
  } else {
    return '8'; // Palavra única para casos difíceis
  }
}

 function formatDateTime(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
// Escolhe texto central com maior área/confiança para evitar ruído
function pickCentralText(data: any, w: number, h: number): string | null {
  try {
    const lines: any[] = Array.isArray(data?.lines) ? data.lines : [];
    const words: any[] = Array.isArray(data?.words) ? data.words : [];
    const cxMin = w * 0.3, cxMax = w * 0.7;
    const cyMin = h * 0.3, cyMax = h * 0.7;

    const scoreItem = (bbox: any, conf: number) => {
      const x0 = bbox?.x0 ?? bbox?.left ?? 0;
      const y0 = bbox?.y0 ?? bbox?.top ?? 0;
      const x1 = bbox?.x1 ?? (bbox?.left ?? 0) + (bbox?.width ?? 0);
      const y1 = bbox?.y1 ?? (bbox?.top ?? 0) + (bbox?.height ?? 0);
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const area = Math.max(1, (x1 - x0) * (y1 - y0));
      const centerBonus = (mx >= cxMin && mx <= cxMax && my >= cyMin && my <= cyMax) ? 1.5 : 1.0;
      return area * centerBonus * (Math.max(0, conf) + 1);
    };

    let bestText: string | null = null;
    let bestScore = 0;

    for (const ln of lines) {
      const t = String(ln?.text || '').trim();
      const conf = typeof ln?.confidence === 'number' ? ln.confidence : 0;
      if (!t) continue;
      const sc = scoreItem(ln?.bbox || ln, conf);
      if (sc > bestScore) { bestScore = sc; bestText = t; }
    }
    for (const wd of words) {
      const t = String(wd?.text || '').trim();
      const conf = typeof wd?.confidence === 'number' ? wd.confidence : 0;
      if (!t) continue;
      const sc = scoreItem(wd?.bbox || wd, conf);
      if (sc > bestScore) { bestScore = sc; bestText = t; }
    }
    if (bestText) return bestText;
    const text = String(data?.text || '').trim();
    return text || null;
  } catch {
    const text = String(data?.text || '').trim();
    return text || null;
  }
}