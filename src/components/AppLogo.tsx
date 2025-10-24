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

        {/* Formas estilizadas (bat-like) */}
        <g filter="url(#glow)">
          <path d="M160 280 Q320 160 480 280" fill="url(#blueGrad)" opacity="0.9" />
          <path d="M180 340 Q320 240 460 340" fill="#1E6FDB" opacity="0.9" />
          <circle cx="250" cy="320" r="24" fill="#FFFFFF" opacity="0.85" />
          <circle cx="390" cy="320" r="24" fill="#FFFFFF" opacity="0.85" />
        </g>

        {/* Título */}
        <text x="320" y="452" textAnchor="middle" fontFamily="Montserrat, system-ui, -apple-system, Segoe UI, Roboto, Arial" fontSize="64" fontWeight="800" fill="#FFFFFF">BAT APP</text>
      </g>

      {/* Linha inferior decorativa (sutil) */}
      <g>
        <path d="M210 500 Q320 540 430 500" stroke="#1E6FDB" strokeWidth="6" strokeLinecap="round" fill="none" opacity="0.6" />
      </g>
    </svg>
  );
}