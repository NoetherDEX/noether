'use client';

import { formatUSD, formatNumber, formatPercent } from '@/lib/utils';
import { TrustlineWarning } from './TrustlineWarning';

interface YourPositionProps {
  noeBalance: number;
  noePrice: number;
  tvl: number;
  apy: number;
  isConnected: boolean;
  isLoading?: boolean;
  hasTrustline: boolean;
  onAddTrustline: () => Promise<void>;
  isAddingTrustline?: boolean;
}

export function YourPositionSkeleton() {
  return (
    <div className="rounded-2xl border border-white/10 bg-card p-6">
      <div className="h-6 w-32 bg-white/5 rounded animate-pulse mb-6" />
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex justify-between items-center">
            <div className="h-4 w-24 bg-white/5 rounded animate-pulse" />
            <div className="h-5 w-20 bg-white/5 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function YourPosition({
  noeBalance,
  noePrice,
  tvl,
  apy,
  isConnected,
  isLoading,
  hasTrustline,
  onAddTrustline,
  isAddingTrustline,
}: YourPositionProps) {
  if (isLoading) {
    return <YourPositionSkeleton />;
  }

  const value = noeBalance * noePrice;
  const poolShare = tvl > 0 ? (value / tvl) * 100 : 0;
  const dailyEarnings = (value * apy / 100) / 365;

  const hasPosition = noeBalance > 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
      <div className="px-6 py-4 border-b border-white/10">
        <h3 className="text-base font-semibold text-foreground">Your Position</h3>
      </div>

      <div className="p-6">
        {!isConnected ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">Connect your wallet to view your position</p>
          </div>
        ) : hasPosition ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">NOE Balance</span>
              <span className="font-mono text-sm font-medium text-foreground">
                {formatNumber(noeBalance, 4)} NOE
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Value</span>
              <span className="font-mono text-sm font-medium text-foreground">
                {formatUSD(value)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Pool Share</span>
              <span className="font-mono text-sm font-medium text-foreground">
                {formatPercent(poolShare)}
              </span>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-white/5">
              <span className="text-sm text-muted-foreground">Est. Daily Earnings</span>
              <span className="font-mono text-sm font-medium text-[#22c55e]">
                ~{formatUSD(dailyEarnings)}
              </span>
            </div>

            {!hasTrustline && (
              <div className="pt-3">
                <TrustlineWarning
                  onAddTrustline={onAddTrustline}
                  isLoading={isAddingTrustline}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="py-8 text-center">
            <p className="text-sm text-foreground mb-1">No liquidity provided yet</p>
            <p className="text-xs text-muted-foreground mb-4">
              Deposit USDC to receive NOE tokens and earn trading fees.
            </p>

            {!hasTrustline && (
              <TrustlineWarning
                onAddTrustline={onAddTrustline}
                isLoading={isAddingTrustline}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
