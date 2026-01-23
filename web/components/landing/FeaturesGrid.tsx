'use client';

import { cn } from '@/lib/utils/cn';

interface FeatureCardProps {
  title: string;
  description: string;
  symbol: string;
  className?: string;
}

function FeatureCard({ title, description, symbol, className }: FeatureCardProps) {
  return (
    <div
      className={cn(
        'group relative p-6 md:p-8 rounded-2xl bg-white/[0.02] border border-white/5',
        'hover:border-white/10 hover:bg-white/[0.03] transition-all duration-300 overflow-hidden',
        className
      )}
    >
      {/* Content */}
      <div className="relative z-10">
        <h3 className="font-heading text-xl font-semibold text-white mb-3">
          {title}
        </h3>
        <p className="text-gray-400 text-sm leading-relaxed">
          {description}
        </p>
      </div>

      {/* Math Symbol Watermark */}
      <div
        className="absolute bottom-0 right-0 text-[10rem] md:text-[12rem] leading-none font-serif text-white/[0.03]
        select-none pointer-events-none transition-all duration-500
        group-hover:text-white/[0.06] group-hover:scale-110 translate-x-4 translate-y-8"
      >
        {symbol}
      </div>
    </div>
  );
}

export function FeaturesGrid() {
  return (
    <section className="py-20 px-6">
      <div className="max-w-6xl mx-auto">
        {/* Bento Grid Layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Row 1 */}
          <FeatureCard
            title="10x Leverage"
            description="Long or Short BTC, ETH, XLM without expiry."
            symbol="∫"
            className="md:col-span-1"
          />
          <FeatureCard
            title="NOE Liquidity Model"
            description="Earn yield by providing USDC liquidity. Protocol revenue sharing."
            symbol="Σ"
            className="md:row-span-2"
          />

          {/* Row 2 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FeatureCard
              title="Soroban Powered"
              description="Built with Rust for maximum security."
              symbol="∞"
            />
            <FeatureCard
              title="Non-Custodial"
              description="You control your funds."
              symbol="Δ"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
