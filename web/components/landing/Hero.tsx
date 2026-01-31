'use client';

import Link from 'next/link';

export function Hero() {
  return (
    <section className="min-h-screen flex flex-col items-center justify-center text-center px-8 pt-32 pb-16 relative z-[1]">
      {/* Main Headline */}
      <h1 className="text-5xl md:text-7xl lg:text-[5rem] font-bold tracking-tight leading-[1.1] mb-6 animate-fade-in-up-delay-1">
        Decentralized Perpetuals
        <br />
        on <span className="shiny-text">Stellar</span> Network
      </h1>

      {/* Tagline */}
      <p className="text-xl text-white/60 max-w-[500px] mb-12 animate-fade-in-up-delay-2">
        Up to 10x leverage on BTC, ETH & XLM. Provide liquidity, earn NOE tokens, and grow your portfolio.
      </p>

      {/* Buttons */}
      <div className="flex gap-4 animate-fade-in-up-delay-3">
        <Link
          href="/trade"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold bg-[#eab308] text-black hover:bg-[#fbbf24] hover:-translate-y-0.5 transition-all"
        >
          Start Trading
        </Link>
        <Link
          href="/vault"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold bg-transparent text-white border border-white/[0.06] hover:border-[#eab308] hover:text-[#eab308] transition-all"
        >
          Provide Liquidity
        </Link>
      </div>
    </section>
  );
}
