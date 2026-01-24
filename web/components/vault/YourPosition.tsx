'use client';

import { BarChart3 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Skeleton } from '@/components/ui';
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
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Your Position</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <Skeleton className="h-4 w-20 mb-2" />
            <Skeleton className="h-7 w-32" />
          </div>
          <div>
            <Skeleton className="h-4 w-16 mb-2" />
            <Skeleton className="h-7 w-24" />
          </div>
          <div>
            <Skeleton className="h-4 w-20 mb-2" />
            <Skeleton className="h-7 w-16" />
          </div>
          <div>
            <Skeleton className="h-4 w-28 mb-2" />
            <Skeleton className="h-7 w-20" />
          </div>
        </div>
      </CardContent>
    </Card>
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
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Your Position</CardTitle>
      </CardHeader>
      <CardContent>
        {!isConnected ? (
          <div className="text-center py-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-white/5 mb-4">
              <BarChart3 className="w-6 h-6 text-neutral-500" />
            </div>
            <p className="text-neutral-400 mb-2">Connect your wallet</p>
            <p className="text-sm text-neutral-500">
              to view your position
            </p>
          </div>
        ) : hasPosition ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-neutral-500 mb-1">NOE Balance</p>
              <p className="text-xl font-semibold text-white">
                {formatNumber(noeBalance, 4)} NOE
              </p>
            </div>
            <div>
              <p className="text-sm text-neutral-500 mb-1">Value</p>
              <p className="text-xl font-semibold text-white">
                {formatUSD(value)}
              </p>
            </div>
            <div>
              <p className="text-sm text-neutral-500 mb-1">Pool Share</p>
              <p className="text-xl font-semibold text-white">
                {formatPercent(poolShare)}
              </p>
            </div>
            <div>
              <p className="text-sm text-neutral-500 mb-1">Est. Daily Earnings</p>
              <p className="text-xl font-semibold text-emerald-400">
                ~{formatUSD(dailyEarnings)}
              </p>
            </div>

            {!hasTrustline && (
              <TrustlineWarning
                onAddTrustline={onAddTrustline}
                isLoading={isAddingTrustline}
              />
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-white/5 mb-4">
              <BarChart3 className="w-6 h-6 text-neutral-500" />
            </div>
            <p className="text-neutral-400 mb-2">
              You&apos;re not providing liquidity yet
            </p>
            <p className="text-sm text-neutral-500 mb-4">
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
      </CardContent>
    </Card>
  );
}
