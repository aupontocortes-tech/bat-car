import React from 'react';

export default function AppLogo({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 640 640" role="img" aria-label="Bat App logo" className={className} {...props}>
      <defs>
        <linearGradient id="blueGrad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#6EC5FF" />
          <stop offset="100%" stopColor="#1E6FDB" />
        </linearGradient>
        <linearGradient id="ringGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#1B66C9" />
          <stop offset="100%" stopColor="#0D47A1" />
        </linearGradient>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="10" stdDeviation="8" floodColor="#001428" floodOpacity="0.45" />
        </filter>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Base transparente */}
      <rect x="0" y="0" width="640" height="640" fill="none" />

      {/* Emblema em anéis */}
      <g filter="url(#shadow)">
        <circle cx="320" cy="320" r="260" fill="none" stroke="#FFFFFF" strokeWidth="20" />
        <circle cx="320" cy="320" r="220" fill="none" stroke="url(#ringGrad)" strokeWidth="14" />
        <circle cx="320" cy="320" r="196" fill="none" stroke="#2B7BD9" strokeOpacity="0.6" strokeWidth="8" />
      </g>

      {/* Carro estilizado com linhas dinâmicas */}
      <g fill="none" stroke="#FFFFFF" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" filter="url(#glow)">
        <path d="M160 360 H430 L470 285 L385 230 H270 L225 270 L180 285 Z" />
        {/* Vidros e detalhes */}
        <path d="M235 275 H320 L350 300" />
        <path d="M190 305 H440" opacity="0.85" />
        <path d="M200 325 H430" opacity="0.6" />
        {/* Rodas */}
        <circle cx="250" cy="380" r="30" />
        <circle cx="400" cy="380" r="30" />
        {/* Brilhos */}
        <path d="M175 250 l8 0 l0 -8 l8 0 l0 8 l8 0 l0 8 l-8 0 l0 8 l-8 0 l0 -8 l-8 0 Z" opacity="0.9" />
        <circle cx="455" cy="245" r="6" opacity="0.9" />
      </g>

      {/* Faixa principal com dobras, inclinada */}
      <g transform="rotate(-8,320,420)" filter="url(#shadow)">
        {/* Corpo da faixa */}
        <path d="M140 420 L500 420 L460 468 L180 468 Z" fill="url(#blueGrad)" />
        {/* Dobra esquerda */}
        <path d="M140 420 L170 445 L180 468 L150 446 Z" fill="#195FB9" opacity="0.9" />
        {/* Dobra direita */}
        <path d="M500 420 L470 445 L460 468 L490 446 Z" fill="#195FB9" opacity="0.9" />
        {/* Texto principal */}
        <text x="320" y="452" textAnchor="middle" fontFamily="Montserrat, system-ui, -apple-system, Segoe UI, Roboto, Arial" fontSize="64" fontWeight="800" fill="#FFFFFF">BAT APP</text>
      </g>

      {/* Linha inferior decorativa (sutil) */}
      <g>
        <path d="M210 500 Q320 540 430 500" stroke="#1E6FDB" strokeWidth="6" strokeLinecap="round" fill="none" opacity="0.6" />
      </g>
    </svg>
  );
}