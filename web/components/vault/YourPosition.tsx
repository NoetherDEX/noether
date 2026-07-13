'use client';

import { formatUSD, formatNumber, formatPercent } from '@/lib/utils';
import { TrustlineWarning } from './TrustlineWarning';

interface YourPositionProps {
  noeBalance: number | null;
  /** null = price read failed/unavailable — value rows render '—' */
  noePrice: number | null;
  tvl: number | null;
  apy: number | null;
  isConnected: boolean;
  isLoading?: boolean;
  hasTrustline: boolean;
  onAddTrustline: () => Promise<void>;
  isAddingTrustline?: boolean;
}

export function YourPositionSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <div className="h-6 w-32 bg-surface-2 rounded animate-pulse mb-6" />
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex justify-between items-center">
            <div className="h-4 w-24 bg-surface-2 rounded animate-pulse" />
            <div className="h-5 w-20 bg-surface-2 rounded animate-pulse" />
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

  // Unknown price/TVL propagate as null and render '—' — never a fake $0
  const value = noePrice != null && noeBalance != null ? noeBalance * noePrice : null;
  const poolShare = value != null && tvl != null && tvl > 0 ? (value / tvl) * 100 : null;
  const dailyEarnings = apy != null && value != null ? (value * apy / 100) / 365 : null;

  const hasPosition = noeBalance != null && noeBalance > 0;

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        <h3 className="text-sm font-medium text-foreground">Your Position</h3>
      </div>

      <div className="p-6">
        {!isConnected ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">Connect your wallet to view your position</p>
          </div>
        ) : noeBalance === null ? (
          <div className="py-8 text-center">
            <p className="text-sm text-foreground mb-1">Couldn&apos;t load your position</p>
            <p className="text-xs text-muted-foreground">Balance read failed — refresh to try again.</p>
          </div>
        ) : hasPosition ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">NOE Balance</span>
              <span className="font-mono tabular-nums text-sm font-medium text-foreground">
                {formatNumber(noeBalance, 4)} NOE
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Value</span>
              <span className="font-mono tabular-nums text-sm font-medium text-foreground">
                {formatUSD(value)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Pool Share</span>
              <span className="font-mono tabular-nums text-sm font-medium text-foreground">
                {formatPercent(poolShare)}
              </span>
            </div>

            {dailyEarnings != null && (
              <div className="flex items-center justify-between pt-3 border-t border-border">
                <span className="text-sm text-muted-foreground">Est. Daily Earnings</span>
                <span className="font-mono tabular-nums text-sm font-medium text-long">
                  ~{formatUSD(dailyEarnings)}
                </span>
              </div>
            )}

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
              Deposit USDC to receive NOE tokens and earn trading fees. The pool is the traders&apos;
              counterparty — principal is at risk.
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
