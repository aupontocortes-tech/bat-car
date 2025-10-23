import AppLogo from '../../components/AppLogo'
import InstallPrompt from '../../components/InstallPrompt'
import UnidasMark from '../../components/UnidasMark'

export default function HomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1976D2] to-[#0D47A1] text-white">
      {/* Badge discreto no topo direito */}
      <div className="fixed top-4 right-4 opacity-80 hover:opacity-100 transition-opacity">
        <UnidasMark />
      </div>

      <div className="text-center space-y-8">
        <div className="flex flex-col items-center gap-4">
          <AppLogo className="w-56 h-56" />
          <button
            onClick={onStart}
            className="px-6 py-4 rounded-lg bg-[#64B5F6] text-white font-bold shadow-lg hover:opacity-95 active:opacity-90"
          >
            Iniciar Leitura Automática
          </button>
        </div>
      </div>

      <div className="fixed bottom-6 right-6">
        <InstallPrompt variant="floating" />
      </div>
    </div>
  );
}