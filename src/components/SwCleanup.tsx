"use client";
import { useEffect } from 'react';

export default function SwCleanup() {
  useEffect(() => {
    const cleanup = async () => {
      try {
        // Desregistra qualquer Service Worker antigo (ex.: CRA sw.js)
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const reg of regs) {
            try { await reg.unregister(); } catch {}
          }
        }
        // Limpa caches antigos para evitar HTML/CSS/JS desatualizados
        if ('caches' in window) {
          const keys = await caches.keys();
          for (const k of keys) {
            try { await caches.delete(k); } catch {}
          }
        }
        // Log simples para diagnóstico
        console.log('[SwCleanup] Service workers desregistrados e caches limpos');
      } catch (e) {
        console.warn('[SwCleanup] Falha ao limpar SW/caches', e);
      }
    };
    cleanup();
  }, []);
  return null;
}