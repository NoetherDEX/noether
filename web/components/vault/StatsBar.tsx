'use client';

import { formatUSD } from '@/lib/utils';

interface StatsBarProps {
  tvl: number;
  noePrice: number;
  apy: number;
  isLoading?: boolean;
}

export function StatsBarSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-4 md:gap-6">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-2xl border border-white/10 bg-card p-4 md:p-6">
          <div className="h-4 w-24 bg-white/5 rounded animate-pulse mb-3" />
          <div className="h-8 w-32 bg-white/5 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export function StatsBar({ tvl, noePrice, apy, isLoading }: StatsBarProps) {
  if (isLoading) {
    return <StatsBarSkeleton />;
  }

  return (
    <div className="grid grid-cols-3 items-stretch gap-4 md:gap-6">
      {/* TVL Card */}
      <div className="rounded-2xl border border-white/10 bg-card p-4 md:p-6">
        <span className="text-xs md:text-sm text-muted-foreground">Total Value Locked</span>
        <div className="mt-2">
          <span className="text-xl md:text-3xl font-bold font-mono text-foreground">{formatUSD(tvl)}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground hidden md:block">Amount of assets locked in the vault</p>
      </div>

      {/* APR Card */}
      <div className="rounded-2xl border border-white/10 bg-card p-4 md:p-6">
        <span className="text-xs md:text-sm text-muted-foreground">Current APR</span>
        <div className="mt-2">
          <span className="text-xl md:text-3xl font-bold font-mono text-[#22c55e]">~{apy.toFixed(1)}%</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground hidden md:block">Variable rate based on trading fees</p>
      </div>

      {/* NOE Price Card */}
      <div className="rounded-2xl border border-white/10 bg-card p-4 md:p-6">
        <span className="text-xs md:text-sm text-muted-foreground">NOE Token Price</span>
        <div className="mt-2">
          <span className="text-xl md:text-3xl font-bold font-mono text-foreground">{formatUSD(noePrice, 3)}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground hidden md:block">Current market price of NOE token</p>
      </div>
    </div>
  );
}
