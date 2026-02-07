interface NoetherLogoProps {
  className?: string;
  /** Background color for the diagonal mask line in the O symbol */
  maskColor?: string;
}

export function NoetherLogo({ className = '', maskColor = '#050508' }: NoetherLogoProps) {
  return (
    <svg
      viewBox="0 0 180 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* N */}
      <path d="M0 6h3v20H0V6zm3 0l12 16V6h3v20h-3L3 10v16H0" fill="currentColor" />
      {/* O with orbital cut - the signature symbol */}
      <g transform="translate(24, 0)">
        {/* Outer circle */}
        <circle cx="16" cy="16" r="12" stroke="#eab308" strokeWidth="2.5" fill="none" />
        {/* Diagonal orbital line creating the N-like cut — mask matches background */}
        <line x1="4" y1="28" x2="28" y2="4" stroke={maskColor} strokeWidth="4" />
        <line x1="4" y1="28" x2="28" y2="4" stroke="#22c55e" strokeWidth="2" />
        {/* Small orbital dot */}
        <circle cx="8" cy="24" r="2.5" fill="#22c55e" />
      </g>
      {/* E */}
      <path d="M60 6h14v3H63v5.5h10v3H63V23h11v3H60V6z" fill="currentColor" />
      {/* T */}
      <path d="M80 6h16v3h-6.5v17h-3V9H80V6z" fill="currentColor" />
      {/* H */}
      <path d="M102 6h3v8.5h10V6h3v20h-3v-8.5h-10V26h-3V6z" fill="currentColor" />
      {/* E */}
      <path d="M124 6h14v3h-11v5.5h10v3h-10V23h11v3h-14V6z" fill="currentColor" />
      {/* R */}
      <path d="M144 6h10c4 0 6 2.5 6 6s-2 5.5-5 6l6 8h-4l-5.5-7.5H147V26h-3V6zm3 3v6.5h7c2 0 3-1.25 3-3.25s-1-3.25-3-3.25h-7z" fill="currentColor" />
    </svg>
  );
}
