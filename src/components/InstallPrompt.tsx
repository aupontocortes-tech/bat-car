"use client";
import { useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string[] }>;
};

export default function InstallPrompt({ variant = 'button', className = '' }: { variant?: 'button' | 'floating'; className?: string }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onBeforeInstall as any);
    window.addEventListener('appinstalled', onInstalled as any);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall as any);
      window.removeEventListener('appinstalled', onInstalled as any);
    };
  }, []);

  const onInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    try {
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      setDeferred(null);
    } catch {}
  };

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

  if (installed) {
    return (
      <div
        className={
          variant === 'floating'
            ? `rounded-full px-3 py-2 bg-green-600 text-white text-xs shadow-lg ${className}`
            : `text-sm opacity-80 ${className}`
        }
      >
        Aplicativo instalado!
      </div>
    );
  }

  if (isIOS && !deferred) {
    const content = 'No iOS, toque em compartilhar e "Adicionar à Tela de Início".';
    return (
      <div
        className={
          variant === 'floating'
            ? `rounded-lg px-3 py-2 bg-white/20 text-white text-xs shadow ${className}`
            : `text-xs opacity-90 max-w-sm mx-auto ${className}`
        }
      >
        {content}
      </div>
    );
  }

  if (variant === 'floating') {
    return (
      <button
        onClick={onInstall}
        disabled={!deferred}
        aria-label="Instalar Bat App"
        className={`rounded-full p-3 bg-[#64B5F6] text-white shadow-xl hover:opacity-95 active:opacity-90 disabled:opacity-60 ${className}`}
        title={!deferred ? 'Aguarde o navegador habilitar a instalação' : 'Instalar Bat App'}
      >
        📲
      </button>
    );
  }

  return (
    <button
      onClick={onInstall}
      disabled={!deferred}
      className={`px-3 py-2 rounded bg-white/10 hover:bg-white/20 disabled:opacity-60 ${className}`}
      title={!deferred ? 'Aguarde o navegador habilitar a instalação' : 'Instalar Bat App'}
    >
      📲 Instalar Bat App
    </button>
  );
}