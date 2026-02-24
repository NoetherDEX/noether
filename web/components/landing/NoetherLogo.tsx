interface NoetherLogoProps {
  className?: string;
  /** When set to a light color, applies a filter to make the logo visible on light backgrounds */
  maskColor?: string;
}

export function NoetherLogo({ className = '', maskColor }: NoetherLogoProps) {
  const isLight = maskColor === '#f8f6f0';

  return (
    <img
      src="/noethersvg.svg"
      alt="Noether"
      className={className}
      style={isLight ? { filter: 'brightness(0)' } : undefined}
      draggable={false}
    />
  );
}
