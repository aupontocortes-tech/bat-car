"use client";
import React, { useEffect, useRef, useState } from "react";
import Tesseract from "tesseract.js";

type PlateCandidate = { text: string; conf: number };

// Padrões de placa: Brasil comum (ABC1234) e Mercosul (ABC1D23)
const platePatterns = [
  /^[A-Z]{3}\d{4}$/i,
  /^[A-Z]{3}\d[A-Z]\d{2}$/i,
];

const FRAME_DELAY_MS = 500; // processa um frame a cada 500ms
const MIN_CONFIDENCE = 0.8; // 80%
const DEDUP_SECONDS = 10; // evita salvar a mesma placa dentro de 10s

export default function PlateReader() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const processIntervalRef = useRef<number | null>(null);
  const [status, setStatus] = useState("Aguardando câmera...");
  const [reading, setReading] = useState(false);
  const [plates, setPlates] = useState<string[]>([]);
  const seenSetRef = useRef<Set<string>>(new Set());
  const dedupMapRef = useRef<Record<string, number>>({});

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
      if (processIntervalRef.current) window.clearInterval(processIntervalRef.current);
    };
  }, []);

  async function startCamera() {
    setStatus("Solicitando câmera...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } as any,
        audio: false,
      });
      const v = videoRef.current;
      if (v) {
        if (v.srcObject !== stream) v.srcObject = stream as any;
        await v.play().catch(() => {});
        setStatus("Câmera ativa");
        startProcessingLoop();
      }
    } catch (err) {
      console.error("Erro ao abrir a câmera:", err);
      setStatus("Permissão negada ou câmera indisponível");
    }
  }

  function stopCamera() {
    const v = videoRef.current;
    const src: any = v?.srcObject;
    if (src && typeof src.getTracks === "function") {
      try { src.getTracks().forEach((t: MediaStreamTrack) => t.stop()); } catch {}
    }
    if (v) (v as any).srcObject = null;
  }

  function startProcessingLoop() {
    if (processIntervalRef.current) return; // já rodando
    processIntervalRef.current = window.setInterval(() => {
      if (!reading) processFrame();
    }, FRAME_DELAY_MS);
  }

  async function processFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (video.readyState < 2) return; // não pronto

    setReading(true);
    setStatus("Lendo placa...");

    // Ajusta canvas para o tamanho do vídeo
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setReading(false); return; }

    // Captura frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    try {
      const { data } = await Tesseract.recognize(canvas, "eng", {
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
        psm: 7,
        load_system_dawg: 0,
        load_freq_dawg: 0,
      } as any);
      const anyData: any = data as any;
      const words: any[] = Array.isArray(anyData?.words) ? anyData.words : [];
      let candidate: PlateCandidate | null = null;
      for (const w of words) {
        const text = String(w.text || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
        const conf = Number(w.confidence || 0) / 100.0; // normaliza 0..1
        if (!text || conf < MIN_CONFIDENCE) continue;
        if (platePatterns.some((pat) => pat.test(text))) {
          candidate = { text, conf };
          break;
        }
      }

      // Se não achou entre palavras, tenta no texto completo
      if (!candidate) {
        const full = String(anyData?.text || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
        const match = platePatterns.find((pat) => pat.test(full));
        if (match) candidate = { text: (full.match(match) || [full])[0].toUpperCase(), conf: 0.8 };
      }

      if (candidate) {
        handleCandidatePlate(candidate.text, candidate.conf);
      } else {
        setStatus("Nenhuma placa válida detectada");
      }
    } catch (err) {
      console.error("Erro OCR:", err);
      setStatus("Erro ao processar OCR");
    } finally {
      setReading(false);
    }
  }

  function handleCandidatePlate(raw: string, conf: number) {
    const normalized = String(raw).replace(/[^A-Z0-9]/gi, "").toUpperCase();
    const now = Date.now();
    const lastSeen = dedupMapRef.current[normalized] || 0;
    if (now - lastSeen < DEDUP_SECONDS * 1000) {
      setStatus(`Placa ${normalized} já vista recentemente`);
      return;
    }
    dedupMapRef.current[normalized] = now;

    if (!seenSetRef.current.has(normalized)) {
      seenSetRef.current.add(normalized);
      setPlates((p) => [normalized, ...p].slice(0, 50));
      setStatus(`Placa detectada: ${normalized} (conf: ${Math.round(conf * 100)}%)`);
    } else {
      setStatus(`Placa detectada novamente: ${normalized}`);
    }

    // limpa o registro depois do tempo de dedup
    window.setTimeout(() => {
      try { delete dedupMapRef.current[normalized]; } catch {}
    }, DEDUP_SECONDS * 1000 + 100);
  }

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h2 className="text-xl font-bold mb-2">Leitor de placas (Tesseract.js)</h2>
      <p className="mb-2">Status: {status}</p>

      <div style={{ position: "relative", width: "100%", maxWidth: 720 }}>
        <video
          ref={videoRef}
          style={{ width: "100%", borderRadius: 12, background: "#000" }}
          muted
          playsInline
        />
        {/* canvas invisível usado para capturar frames */}
        <canvas ref={canvasRef} style={{ display: "none" }} />

        {/* Overlay simples com instruções */}
        <div
          style={{
            position: "absolute",
            left: 8,
            top: 8,
            background: "rgba(0,0,0,0.5)",
            color: "#fff",
            padding: "6px 8px",
            borderRadius: 8,
            fontSize: 12,
          }}
        >
          Aponte a câmera para a placa. Aguarde leitura.
        </div>
      </div>

      <div className="mt-4">
        <div className="font-semibold mb-2">Placas detectadas</div>
        {plates.length === 0 ? (
          <div className="text-sm text-black/60">Nenhuma placa ainda.</div>
        ) : (
          <ul className="text-sm">
            {plates.map((p) => (
              <li key={p} className="py-1 font-mono">{p}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}