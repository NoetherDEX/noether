'use client';

import { Lock, TrendingUp, DollarSign } from 'lucide-react';
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
      <div className="relative group">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#8b5cf6]/20 to-[#3b82f6]/10 opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="relative rounded-2xl border border-white/10 bg-card p-4 md:p-6">
          <div className="flex items-center gap-2 md:gap-3 mb-3 md:mb-4">
            <div className="p-2 md:p-2.5 rounded-xl bg-[#8b5cf6]/10 border border-[#8b5cf6]/20">
              <Lock className="h-4 w-4 md:h-5 md:w-5 text-[#8b5cf6]" />
            </div>
            <span className="text-xs md:text-sm text-muted-foreground font-medium">Total Value Locked</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl md:text-3xl font-bold font-mono text-foreground">{formatUSD(tvl)}</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground hidden md:block">Amount of assets locked in the vault</p>
        </div>
      </div>

      {/* APR Card */}
      <div className="relative group">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#22c55e]/20 to-[#22c55e]/5 opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="relative rounded-2xl border border-white/10 bg-card p-4 md:p-6">
          <div className="flex items-center gap-2 md:gap-3 mb-3 md:mb-4">
            <div className="p-2 md:p-2.5 rounded-xl bg-[#22c55e]/10 border border-[#22c55e]/20">
              <TrendingUp className="h-4 w-4 md:h-5 md:w-5 text-[#22c55e]" />
            </div>
            <span className="text-xs md:text-sm text-muted-foreground font-medium">Current APR</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl md:text-3xl font-bold font-mono text-[#22c55e]">~{apy.toFixed(1)}%</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground hidden md:block">Variable rate based on trading fees</p>
        </div>
      </div>

      {/* NOE Price Card */}
      <div className="relative group">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#3b82f6]/20 to-[#3b82f6]/5 opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="relative rounded-2xl border border-white/10 bg-card p-4 md:p-6">
          <div className="flex items-center gap-2 md:gap-3 mb-3 md:mb-4">
            <div className="p-2 md:p-2.5 rounded-xl bg-[#3b82f6]/10 border border-[#3b82f6]/20">
              <DollarSign className="h-4 w-4 md:h-5 md:w-5 text-[#3b82f6]" />
            </div>
            <span className="text-xs md:text-sm text-muted-foreground font-medium">NOE Token Price</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl md:text-3xl font-bold font-mono text-foreground">{formatUSD(noePrice, 3)}</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground hidden md:block">Current market price of NOE token</p>
        </div>
      </div>
    </div>
  );
}
