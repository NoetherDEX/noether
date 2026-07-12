'use client';

import { useState, useEffect } from 'react';
import { Shield } from 'lucide-react';
import { getCrossMarginBalance } from '@/lib/stellar/market';
import { formatUSD } from '@/lib/utils';
import { cn } from '@/lib/utils/cn';
import type { DisplayPosition } from '@/types';

interface CrossMarginBannerProps {
  positions: DisplayPosition[];
  publicKey: string | null;
}

const MAINTENANCE_MARGIN_BPS = 100; // 1%

export function CrossMarginBanner({ positions, publicKey }: CrossMarginBannerProps) {
  const [poolBalance, setPoolBalance] = useState<number>(0);

  const crossPositions = positions.filter(p => p.marginMode === 'Cross');

  useEffect(() => {
    if (!publicKey) return;
    const load = async () => {
      try {
        const bal = await getCrossMarginBalance(publicKey);
        setPoolBalance(Number(bal) / 10_000_000);
      } catch {
        setPoolBalance(0);
      }
    };
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [publicKey]);

  if (crossPositions.length === 0 && poolBalance <= 0) return null;

  const totalCollateral = crossPositions.reduce((sum, p) => sum + p.collateral, 0);
  const totalUnrealizedPnl = crossPositions.reduce((sum, p) => sum + p.pnl, 0);
  const totalSize = crossPositions.reduce((sum, p) => sum + p.size, 0);

  // Any position with an unknown mark (pnl = NaN) makes equity unknown —
  // show '—' and a neutral state, never "At Risk" red from NaN comparisons.
  const pnlUnknown = !Number.isFinite(totalUnrealizedPnl);

  const equity = poolBalance + totalCollateral + totalUnrealizedPnl;
  const maintenanceMargin = totalSize * MAINTENANCE_MARGIN_BPS / 10000;
  const usedMargin = totalCollateral;
  const freeMargin = equity - usedMargin;
  const marginRatio = maintenanceMargin > 0 ? (equity / maintenanceMargin) * 100 : Infinity;

  const healthColor = pnlUnknown
    ? 'text-muted-foreground'
    : marginRatio === Infinity
    ? 'text-long'
    : marginRatio > 300
    ? 'text-long'
    : marginRatio > 100
    ? 'text-primary'
    : 'text-short';

  const healthBg = pnlUnknown
    ? 'border-border bg-surface-2'
    : marginRatio === Infinity
    ? 'border-long/25 bg-long/10'
    : marginRatio > 300
    ? 'border-long/25 bg-long/10'
    : marginRatio > 100
    ? 'border-primary/25 bg-primary/10'
    : 'border-short/25 bg-short/10';

  const healthLabel = pnlUnknown
    ? 'Mark price unavailable'
    : marginRatio === Infinity
    ? 'Healthy'
    : marginRatio > 300
    ? 'Healthy'
    : marginRatio > 100
    ? 'Caution'
    : 'At Risk';

  return (
    <div className={cn('mb-3 p-2.5 rounded-lg border', healthBg)}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Shield className={cn('w-3.5 h-3.5', healthColor)} />
        <span className={cn('text-xs font-medium', healthColor)}>
          Cross-Margin Account — {healthLabel}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1">
        <div className="flex justify-between sm:flex-col sm:gap-0">
          <span className="text-[11px] text-muted-foreground">Equity</span>
          <span className="text-xs font-mono text-foreground">{formatUSD(equity)}</span>
        </div>
        <div className="flex justify-between sm:flex-col sm:gap-0">
          <span className="text-[11px] text-muted-foreground">Used Margin</span>
          <span className="text-xs font-mono text-foreground">{formatUSD(usedMargin)}</span>
        </div>
        <div className="flex justify-between sm:flex-col sm:gap-0">
          <span className="text-[11px] text-muted-foreground">Free Margin</span>
          <span className={cn('text-xs font-mono', Number.isFinite(freeMargin) && freeMargin < 0 ? 'text-short' : 'text-foreground')}>
            {formatUSD(freeMargin)}
          </span>
        </div>
        <div className="flex justify-between sm:flex-col sm:gap-0">
          <span className="text-[11px] text-muted-foreground">Margin Ratio</span>
          <span className={cn('text-xs font-mono', healthColor)}>
            {marginRatio === Infinity
              ? '--'
              : Number.isFinite(marginRatio)
              ? `${marginRatio.toFixed(0)}%`
              : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}
