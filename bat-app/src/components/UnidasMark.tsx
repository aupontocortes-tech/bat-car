export default function UnidasMark({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 text-white/90 ${className}`} aria-label="unidas aluguel de carros">
      <div className="w-6 h-6 rounded-full border-4 border-white/90 relative">
        <div className="absolute inset-1 rounded-full bg-transparent"></div>
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-wide lowercase">unidas</div>
        <div className="text-[10px] opacity-80">aluguel de carros</div>
      </div>
    </div>
  );
}