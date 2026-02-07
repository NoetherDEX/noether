import Image from 'next/image';

const TOKEN_LOGOS: Record<string, string> = {
  BTC: '/btclogo.png',
  ETH: '/ethlogo.svg',
  XLM: '/xlmlogo.png',
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
    <Image
      src={src}
      alt={symbol}
      width={size}
      height={size}
      className={`rounded-full ${className}`}
    />
  );
}
