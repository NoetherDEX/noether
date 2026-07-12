'use client';

import { formatUSD } from '@/lib/utils';

interface StatsBarProps {
  /** null = unknown (read failed or wallet-gated) — renders '—', never a fake $0 */
  tvl: number | null;
  /** null = price read failed — renders '—', never a fabricated $1.00 */
  noePrice: number | null;
  /** null until real fee-revenue-based APR can be computed (W-3/P4-15). */
  apy: number | null;
  isLoading?: boolean;
}

export function StatsBarSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 border-y border-border divide-y sm:divide-y-0 sm:divide-x divide-border">
      {[1, 2, 3].map((i) => (
        <div key={i} className="py-4 sm:px-6 sm:first:pl-0 sm:last:pr-0">
          <div className="h-3 w-24 bg-surface-2 rounded animate-pulse mb-3" />
          <div className="h-6 w-32 bg-surface-2 rounded animate-pulse" />
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
    <div className="grid grid-cols-1 sm:grid-cols-3 border-y border-border divide-y sm:divide-y-0 sm:divide-x divide-border">
      {/* TVL */}
      <div className="py-4 sm:px-6 sm:first:pl-0 sm:last:pr-0">
        <span className="text-[11px] uppercase tracking-wide text-faint">Total Value Locked</span>
        <div className="mt-1.5">
          <span className="text-lg font-medium font-mono tabular-nums text-foreground">{formatUSD(tvl)}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground hidden md:block">Amount of assets locked in the vault</p>
      </div>

      {/* APR */}
      <div className="py-4 sm:px-6 sm:first:pl-0 sm:last:pr-0">
        <span className="text-[11px] uppercase tracking-wide text-faint">Current APR</span>
        <div className="mt-1.5">
          {apy != null ? (
            <span className="text-lg font-medium font-mono tabular-nums text-long">~{apy.toFixed(1)}%</span>
          ) : (
            <span className="text-lg font-medium font-mono tabular-nums text-muted-foreground">—</span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground hidden md:block">
          {apy != null ? 'Variable rate based on trading fees' : 'Shown once fee revenue is tracked'}
        </p>
      </div>

      {/* NOE Price */}
      <div className="py-4 sm:px-6 sm:first:pl-0 sm:last:pr-0">
        <span className="text-[11px] uppercase tracking-wide text-faint">NOE Token Price</span>
        <div className="mt-1.5">
          <span className="text-lg font-medium font-mono tabular-nums text-foreground">{formatUSD(noePrice, 3)}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground hidden md:block">Current market price of NOE token</p>
      </div>
    </div>
  );
}
