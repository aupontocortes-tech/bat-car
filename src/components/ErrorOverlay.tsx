"use client";
import { useEffect, useState } from 'react';

export default function ErrorOverlay() {
  const [err, setErr] = useState<{ message: string; stack?: string } | null>(null);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const msg = event.message || (event.error ? String(event.error.message || event.error) : 'Erro desconhecido');
      const stack = event.error?.stack || undefined;
      setErr({ message: msg, stack });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason: any = event.reason;
      const msg = reason?.message || String(reason);
      const stack = reason?.stack || undefined;
      setErr({ message: msg, stack });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection as any);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection as any);
    };
  }, []);

  if (!err) return null;

  const stackPreview = err.stack
    ? err.stack.split('\n').slice(0, 3).join('\n')
    : undefined;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white text-black rounded-lg shadow-xl overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between border-b">
          <div className="font-semibold text-red-700">Erro de execução</div>
          <button
            onClick={() => setErr(null)}
            className="px-2 py-1 rounded bg-black/10 hover:bg-black/20"
            aria-label="Fechar"
          >
            ✖
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-sm font-mono break-words">
            {err.message}
          </div>
          {stackPreview && (
            <pre className="text-xs bg-black/5 p-3 rounded overflow-x-auto">
              {stackPreview}
            </pre>
          )}
          <div className="text-xs text-black/60">
            Se possível, capture esta tela e me envie para correção rápida.
          </div>
        </div>
        <div className="px-4 py-3 flex items-center justify-end gap-2 border-t bg-black/5">
          <button
            onClick={() => setErr(null)}
            className="px-3 py-2 rounded bg-[#0D47A1] text-white hover:opacity-95"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}