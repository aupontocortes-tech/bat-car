export default function HomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1976D2] to-[#0D47A1] text-white">
      <div className="text-center space-y-6">
        <div className="flex flex-col items-center gap-4">
          <CarIcon className="w-20 h-20 text-white" />
          <h1 className="text-3xl font-bold">Bat App</h1>
        </div>
        <button
          onClick={onStart}
          className="px-6 py-4 rounded-lg bg-[#64B5F6] text-white font-bold shadow-lg hover:opacity-95 active:opacity-90"
        >
          Iniciar Leitura Automática
        </button>
      </div>
    </div>
  );
}

function CarIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 32" fill="currentColor" aria-label="Carro" role="img" {...props}>
      <path d="M8 18h36l4-8-10-6H22l-6 6H10z" />
      <circle cx="22" cy="24" r="3" />
      <circle cx="40" cy="24" r="3" />
    </svg>
  );
}