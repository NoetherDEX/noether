'use client';

import { Wallet } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { TokenIcon } from '@/components/ui/TokenIcon';
import type { DisplayPosition } from '@/types';

interface AssetAllocationProps {
  /** Positions with a known price (fresh or last-good) — the page excludes unpriced ones. */
  positions: DisplayPosition[];
  usdcBalance: number;
  /** A8: assets whose value uses a last-good (stale) price — rows get a badge. */
  staleAssets?: string[];
}

// Asset colors mapping — restrained chart hues from the token palette
const assetColors: Record<string, string> = {
  USDC: 'hsl(var(--chart-1))',
  XLM: 'hsl(var(--chart-2))',
  BTC: 'hsl(var(--chart-3))',
  ETH: 'hsl(var(--chart-4))',
};

export function AssetAllocation({ positions, usdcBalance, staleAssets = [] }: AssetAllocationProps) {
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

  // Add position collateral by asset (positions are pre-filtered by the page
  // to those with a known price, so pnl is always a real number here)
  const positionsByAsset = positions.reduce((acc, p) => {
    if (!acc[p.asset]) {
      acc[p.asset] = 0;
    }
    acc[p.asset] += p.collateral + (Number.isFinite(p.pnl) ? p.pnl : 0);
    return acc;
  }, {} as Record<string, number>);

  Object.entries(positionsByAsset).forEach(([asset, value]) => {
    if (value > 0) {
      allocations.push({
        asset,
        value,
        color: assetColors[asset] || 'hsl(var(--faint))',
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
  const healthColor = stablePercent >= 70 ? 'text-long' : stablePercent >= 40 ? 'text-primary' : 'text-short';

  if (allocationsWithPercent.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4 flex flex-col">
        <div className="flex items-center gap-2 mb-4">
          <Wallet className="h-4 w-4 text-faint" />
          <span className="text-[13px] font-medium text-foreground">Asset Allocation</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center py-8">
            <Wallet className="w-10 h-10 text-faint mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">
              No assets to display
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-faint" />
          <span className="text-[13px] font-medium text-foreground">Asset Allocation</span>
        </div>
        <span className="font-mono tabular-nums text-sm text-muted-foreground">
          ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>

      {/* Stacked Bar */}
      <div className="h-2 rounded-sm overflow-hidden flex mb-6">
        {allocationsWithPercent.map((item, i) => (
          <div
            key={item.asset}
            className="h-full"
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
            className="flex items-center justify-between px-3 py-2 rounded-md bg-surface-2 border border-border"
          >
            <div className="flex items-center gap-3">
              {/* Asset Icon */}
              <TokenIcon symbol={item.asset} size={32} />
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-foreground">{item.asset}</span>
                  {staleAssets.includes(item.asset) && (
                    <span
                      className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-sm bg-primary/10 text-primary border border-primary/20"
                      title="Live price read failed — value uses the last known price"
                    >
                      Stale
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{item.type}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono tabular-nums text-sm font-medium text-foreground">
                ${item.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="flex items-center gap-2">
                {/* Mini progress bar */}
                <div className="w-16 h-1 bg-surface-3 rounded-sm overflow-hidden">
                  <div
                    className="h-full rounded-sm"
                    style={{ width: `${item.percentage}%`, backgroundColor: item.color }}
                  />
                </div>
                <span className="font-mono tabular-nums text-xs text-muted-foreground">{item.percentage.toFixed(0)}%</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Collateral Health */}
      <div className="mt-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Collateral Health</span>
          <span className={cn('font-medium', healthColor)}>{healthStatus}</span>
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
