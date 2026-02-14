import Image from 'next/image';

const TOKEN_LOGOS: Record<string, string> = {
  BTC: '/btclogo.svg',
  ETH: '/ethlogo.svg',
  XLM: '/xlmlogo.svg',
  USDC: '/usdclogo.png',
  NOE: '/favicon.svg',
};

interface TokenIconProps {
  symbol: string;
  size?: number;
  className?: string;
}

export function TokenIcon({ symbol, size = 24, className = '' }: TokenIconProps) {
  const src = TOKEN_LOGOS[symbol.toUpperCase()];

  if (!src) {
    // Fallback: colored circle with first letter
    return (
      <div
        className={`rounded-full flex items-center justify-center bg-white/10 text-white font-bold ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.4 }}
      >
        {symbol.charAt(0)}
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-full overflow-hidden flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <Image
        src={src}
        alt={symbol}
        fill
        className="object-contain"
      />
    </div>
  );
}
