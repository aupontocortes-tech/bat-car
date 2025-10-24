import React from 'react';

export default function AppLogo({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 500 500"
      role="img"
      aria-label="BAT APP logo"
      className={className}
      {...props}
    >
      <defs>
        <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0D2147" />
          <stop offset="100%" stopColor="#0B1530" />
        </linearGradient>
        <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8FD7FF" />
          <stop offset="100%" stopColor="#5FA8FF" />
        </linearGradient>
        <linearGradient id="bannerGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8BD8FF" />
          <stop offset="50%" stopColor="#2A7FEA" />
          <stop offset="100%" stopColor="#8BD8FF" />
        </linearGradient>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#001428" floodOpacity="0.35" />
        </filter>
      </defs>

      {/* dark background circle to echo the reference */}
      <circle cx="250" cy="250" r="240" fill="url(#bgGrad)" />

      {/* double rings */}
      <g filter="url(#shadow)">
        <circle cx="250" cy="250" r="190" fill="none" stroke="#FFFFFF" strokeWidth="10" opacity="0.9" />
        <circle cx="250" cy="250" r="170" fill="none" stroke="url(#ringGrad)" strokeWidth="8" opacity="0.9" />
      </g>

      {/* car silhouette (simple geometric strokes) */}
      <g stroke="#FFFFFF" strokeWidth="8" fill="none" opacity="0.95">
        {/* roof and windows */}
        <path d="M150 220 L200 200 L290 200 L330 230" strokeLinecap="round" />
        <path d="M200 200 L220 220 L270 220 L290 200" strokeLinecap="round" />
        {/* body */}
        <path d="M120 260 L150 240 L340 240 L380 260 L380 270 L110 270 Z" strokeLinecap="round" />
        {/* details */}
        <path d="M180 240 L210 240" />
        <path d="M240 240 L310 240" />
        {/* wheels */}
        <circle cx="170" cy="270" r="22" />
        <circle cx="320" cy="270" r="22" />
      </g>

      {/* sparkles */}
      <g fill="#FFFFFF" opacity="0.9">
        <path d="M120 200 L125 210 L115 210 Z" />
        <path d="M360 200 L365 210 L355 210 Z" />
      </g>

      {/* angled banner with title */}
      <g transform="translate(90,280) skewX(-15)">
        <rect x="0" y="0" width="320" height="60" rx="8" fill="url(#bannerGrad)" />
        <text
          x="160"
          y="40"
          textAnchor="middle"
          fontFamily="Montserrat, system-ui, -apple-system, Segoe UI, Roboto, Arial"
          fontSize="42"
          fontWeight="800"
          fill="#FFFFFF"
        >
          BAT-APP
        </text>
      </g>

    </svg>
  );
}