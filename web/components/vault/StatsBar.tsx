'use client';

import { Card } from '@/components/ui';
import { Skeleton } from '@/components/ui';
import { formatUSD } from '@/lib/utils';

interface StatsBarProps {
  tvl: number;
  noePrice: number;
  apy: number;
  isLoading?: boolean;
}

export function StatsBarSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-8">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="p-4 md:p-6 text-center">
          <Skeleton className="h-3 md:h-4 w-16 md:w-24 mx-auto mb-2" />
          <Skeleton className="h-6 md:h-8 w-20 md:w-32 mx-auto" />
        </Card>
      ))}
    </div>
  );
}

export function StatsBar({ tvl, noePrice, apy, isLoading }: StatsBarProps) {
  if (isLoading) {
    return <StatsBarSkeleton />;
  }

  return (
    <div className="grid grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-8">
      <Card className="p-4 md:p-6 text-center">
        <p className="text-xs md:text-sm text-neutral-500 mb-1">TVL</p>
        <p className="text-lg md:text-2xl font-bold text-white">{formatUSD(tvl)}</p>
      </Card>
      <Card className="p-4 md:p-6 text-center">
        <p className="text-xs md:text-sm text-neutral-500 mb-1">NOE Price</p>
        <p className="text-lg md:text-2xl font-bold text-white">{formatUSD(noePrice, 3)}</p>
      </Card>
      <Card className="p-4 md:p-6 text-center">
        <p className="text-xs md:text-sm text-neutral-500 mb-1">Est. APY</p>
        <p className="text-lg md:text-2xl font-bold text-emerald-400">~{apy.toFixed(1)}%</p>
      </Card>
    </div>
  );
}
