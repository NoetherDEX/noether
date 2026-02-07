'use client';

import { Wallet } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { TokenIcon } from '@/components/ui/TokenIcon';
import type { DisplayPosition } from '@/types';

interface AssetAllocationProps {
  positions: DisplayPosition[];
  usdcBalance: number;
}

// Asset colors mapping
const assetColors: Record<string, string> = {
  USDC: '#3b82f6',
  XLM: '#eab308',
  BTC: '#f59e0b',
  ETH: '#627eea',
};

export function AssetAllocation({ positions, usdcBalance }: AssetAllocationProps) {
  // Calculate allocation from positions and USDC balance
  const allocations: { asset: string; value: number; color: string; type: string }[] = [];

  // Add USDC balance
  if (usdcBalance > 0) {
    allocations.push({
      asset: 'USDC',
      value: usdcBalance,
      color: assetColors.USDC,
      type: 'Stablecoin',
    });
  }

  // Add position collateral by asset
  const positionsByAsset = positions.reduce((acc, p) => {
    if (!acc[p.asset]) {
      acc[p.asset] = 0;
    }
    acc[p.asset] += p.collateral + p.pnl;
    return acc;
  }, {} as Record<string, number>);

  Object.entries(positionsByAsset).forEach(([asset, value]) => {
    if (value > 0) {
      allocations.push({
        asset,
        value,
        color: assetColors[asset] || '#666',
        type: 'Position',
      });
    }
  });

  const totalValue = allocations.reduce((sum, a) => sum + a.value, 0);

  // Calculate percentages
  const allocationsWithPercent = allocations.map(a => ({
    ...a,
    percentage: totalValue > 0 ? (a.value / totalValue) * 100 : 0,
  }));

  // Sort by value descending
  allocationsWithPercent.sort((a, b) => b.value - a.value);

  // Determine collateral health
  const stablePercent = allocationsWithPercent.find(a => a.asset === 'USDC')?.percentage || 0;
  const healthStatus = stablePercent >= 70 ? 'Excellent' : stablePercent >= 40 ? 'Good' : 'At Risk';
  const healthColor = stablePercent >= 70 ? 'text-[#22c55e]' : stablePercent >= 40 ? 'text-[#f59e0b]' : 'text-[#ef4444]';

  if (allocationsWithPercent.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-card p-4 flex flex-col">
        <div className="flex items-center gap-2 mb-4">
          <Wallet className="h-5 w-5 text-white/40" />
          <span className="font-semibold text-foreground">Asset Allocation</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center py-8">
            <Wallet className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">
              No assets to display
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-card p-4 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-white/40" />
          <span className="font-semibold text-foreground">Asset Allocation</span>
        </div>
        <span className="font-mono text-sm text-muted-foreground">
          ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>

      {/* Stacked Bar */}
      <div className="h-3 rounded-full overflow-hidden flex mb-6">
        {allocationsWithPercent.map((item, i) => (
          <div
            key={item.asset}
            className="h-full transition-all"
            style={{
              width: `${item.percentage}%`,
              backgroundColor: item.color,
              marginLeft: i > 0 ? '2px' : 0,
            }}
          />
        ))}
      </div>

      {/* Allocation List */}
      <div className="flex-1 flex flex-col gap-3">
        {allocationsWithPercent.map((item) => (
          <div
            key={item.asset}
            className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-white/5"
          >
            <div className="flex items-center gap-3">
              {/* Asset Icon */}
              <TokenIcon symbol={item.asset} size={32} />
              <div>
                <div className="font-medium text-foreground">{item.asset}</div>
                <div className="text-xs text-muted-foreground">{item.type}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-sm font-semibold text-foreground">
                ${item.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="flex items-center gap-2">
                {/* Mini progress bar */}
                <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${item.percentage}%`, backgroundColor: item.color }}
                  />
                </div>
                <span className="font-mono text-xs text-muted-foreground">{item.percentage.toFixed(0)}%</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Collateral Health */}
      <div className="mt-4 pt-4 border-t border-white/10">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Collateral Health</span>
          <span className={cn('font-semibold', healthColor)}>{healthStatus}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {stablePercent >= 70
            ? 'Your portfolio is well-diversified with stable assets.'
            : stablePercent >= 40
            ? 'Consider adding more stablecoins for safety.'
            : 'High risk - consider reducing position exposure.'}
        </p>
      </div>
    </div>
  );
}
