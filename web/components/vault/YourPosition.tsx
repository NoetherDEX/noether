'use client';

import { Wallet, TrendingUp, PieChart, Coins } from 'lucide-react';
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
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/10">
        <h3 className="text-base font-semibold text-foreground">Your Position</h3>
      </div>

      <div className="p-6">
        {!isConnected ? (
          <div className="text-center py-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-[#8b5cf6]/10 to-[#3b82f6]/10 mb-4">
              <Wallet className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-foreground font-medium mb-1">Connect your wallet</p>
            <p className="text-sm text-muted-foreground">
              to view your position
            </p>
          </div>
        ) : hasPosition ? (
          <div className="space-y-5">
            {/* NOE Balance */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[#8b5cf6]/10">
                  <Coins className="h-4 w-4 text-[#8b5cf6]" />
                </div>
                <span className="text-sm text-muted-foreground">NOE Balance</span>
              </div>
              <span className="font-mono font-semibold text-foreground">
                {formatNumber(noeBalance, 4)} NOE
              </span>
            </div>

            {/* Value */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[#3b82f6]/10">
                  <TrendingUp className="h-4 w-4 text-[#3b82f6]" />
                </div>
                <span className="text-sm text-muted-foreground">Value</span>
              </div>
              <span className="font-mono font-semibold text-foreground">
                {formatUSD(value)}
              </span>
            </div>

            {/* Pool Share */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[#22c55e]/10">
                  <PieChart className="h-4 w-4 text-[#22c55e]" />
                </div>
                <span className="text-sm text-muted-foreground">Pool Share</span>
              </div>
              <span className="font-mono font-semibold text-foreground">
                {formatPercent(poolShare)}
              </span>
            </div>

            {/* Daily Earnings */}
            <div className="flex items-center justify-between pt-3 border-t border-white/5">
              <span className="text-sm text-muted-foreground">Est. Daily Earnings</span>
              <span className="font-mono font-semibold text-[#22c55e]">
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
          <div className="text-center py-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-[#8b5cf6]/10 to-[#3b82f6]/10 mb-4">
              <Coins className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-foreground font-medium mb-1">
              You&apos;re not providing liquidity yet
            </p>
            <p className="text-sm text-muted-foreground mb-4 max-w-xs mx-auto">
              Deposit USDC to receive NOE tokens and start earning from trading fees.
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
