'use client';

import { ArrowUpRight, ArrowDownRight, Wallet, TrendingUp, Shield } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { formatUSD, formatPercent } from '@/lib/utils/format';
import { ConnectButton } from '@/components/wallet';
import type { DisplayPosition } from '@/types';

interface AccountHealthProps {
  /** Positions with a known price (fresh or last-good) — the page excludes unpriced ones. */
  positions: DisplayPosition[];
  /** null = wallet balance read failed — Net Worth / Buying Power render '—'. */
  usdcBalance: number | null;
  isConnected: boolean;
  /** A9: cross-margin pool balance in display units; null = not read yet (renders '—'). */
  crossMarginBalance?: number | null;
  /** A8: collateral locked in positions whose price is unknown (still real money). */
  unpricedCollateral?: number;
  /** A8: positions excluded for lack of a price — PnL and net worth render '—'. */
  unpricedCount?: number;
  /** A8: true when any displayed price is a last-good (stale) oracle read. */
  pricesStale?: boolean;
  onDeposit?: () => void;
  onWithdraw?: () => void;
}

function StaleBadge() {
  return (
    <span
      className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-sm bg-primary/10 text-primary border border-primary/20"
      title="Live price read failed — values use the last known price"
    >
      Stale
    </span>
  );
}

export function AccountHealth({
  positions,
  usdcBalance,
  isConnected,
  crossMarginBalance = null,
  unpricedCollateral = 0,
  unpricedCount = 0,
  pricesStale = false,
}: AccountHealthProps) {
  // Calculate totals from positions. Collateral is price-independent, so
  // unpriced positions still count toward it; their PnL is unknown.
  const totalCollateral = positions.reduce((sum, p) => sum + p.collateral, 0) + unpricedCollateral;
  const pnlKnown = unpricedCount === 0;
  const totalUnrealizedPnl = positions.reduce((sum, p) => sum + (Number.isFinite(p.pnl) ? p.pnl : 0), 0);
  // Net worth mirrors CrossMarginBanner's proven equity formula (pool balance
  // + collateral + unrealized PnL) plus the wallet balance. An unknown part
  // makes the whole unknown — render '—', never a fabricated number.
  const netWorth =
    pnlKnown && crossMarginBalance !== null && usdcBalance !== null
      ? usdcBalance + crossMarginBalance + totalCollateral + totalUnrealizedPnl
      : null;
  const buyingPower = usdcBalance;

  // B13: ONE canonical health scalar — the same margin-ratio formula and
  // bands as /trade's CrossMarginBanner (equity / maintenance margin, 1% MM,
  // liquidation at 100%) — replacing the invented "Safe/Moderate/High"
  // heuristic that could read "Safe" one tick from liquidation.
  const totalSize = positions.reduce((sum, p) => sum + p.size, 0);
  const maintenanceMargin = totalSize * 0.01;
  const tradingEquity =
    pnlKnown && crossMarginBalance !== null
      ? crossMarginBalance + totalCollateral + totalUnrealizedPnl
      : null;
  const marginRatio =
    tradingEquity === null
      ? null
      : maintenanceMargin > 0
      ? (tradingEquity / maintenanceMargin) * 100
      : Infinity;
  // Bar shows distance TOWARD liquidation (full bar = liquidatable).
  const liqProximityPct =
    marginRatio === null || marginRatio === Infinity
      ? 0
      : Math.min(100, 10000 / Math.max(marginRatio, 1));

  // Calculate monthly change (mock for now - would need historical data)
  const monthlyChangePercent =
    netWorth !== null && netWorth - totalUnrealizedPnl !== 0
      ? (totalUnrealizedPnl / (netWorth - totalUnrealizedPnl)) * 100
      : null;
  const isPositiveMonth = (monthlyChangePercent ?? 0) >= 0;
  const isPnlPositive = totalUnrealizedPnl >= 0;
  const pnlPercent = !pnlKnown
    ? null
    : totalCollateral > 0
    ? (totalUnrealizedPnl / totalCollateral) * 100
    : 0;

  if (!isConnected) {
    return (
      <div className="grid grid-cols-1 gap-4">
        <div className="rounded-lg border border-border bg-surface p-6">
          <div className="text-center py-8">
            <Wallet className="w-12 h-12 text-faint mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">Connect Your Wallet</h3>
            <p className="text-sm text-muted-foreground mb-5">
              Connect your wallet to view your portfolio and positions
            </p>
            {/* B12: the connect card carries the connect ACTION — no hunting
                for the header button. */}
            <div className="inline-flex">
              <ConnectButton />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">
      {/* Net Worth Card - Left Column */}
      <div className="rounded-lg border border-border bg-surface p-6">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-faint mb-2">
            <Wallet className="h-3.5 w-3.5" />
            <span>Net Worth</span>
            {pricesStale && <StaleBadge />}
          </div>
          <div
            className="font-mono tabular-nums text-2xl sm:text-3xl font-medium text-foreground tracking-tight"
            title={netWorth === null ? 'Unavailable — a price or balance read is missing' : undefined}
          >
            {formatUSD(netWorth)}
          </div>
          {monthlyChangePercent !== null && (
            <div className={cn(
              'flex items-center gap-1 mt-2 text-sm',
              isPositiveMonth ? 'text-long' : 'text-short'
            )}>
              {isPositiveMonth ? (
                <ArrowUpRight className="h-4 w-4" />
              ) : (
                <ArrowDownRight className="h-4 w-4" />
              )}
              <span className="font-mono tabular-nums">
                {formatPercent(monthlyChangePercent)}
              </span>
              {/* B13: this figure derives from OPEN positions' PnL — calling
                  it "this month" was a fabrication. */}
              <span className="text-muted-foreground ml-1">open PnL</span>
            </div>
          )}
          {/* A9: reconcilable breakdown line — funds parked in the cross-margin pool */}
          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Cross-Margin Balance</span>
            <span className="font-mono tabular-nums text-foreground">{formatUSD(crossMarginBalance)}</span>
          </div>
        </div>
      </div>

      {/* Stats Group - Right Column */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 h-full">
        {/* Unrealized PnL */}
        <div className="rounded-lg border border-border bg-surface p-4 flex flex-col justify-center">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-faint mb-2">
            <TrendingUp className="h-3.5 w-3.5" />
            <span>Unrealized PnL</span>
            {pricesStale && <StaleBadge />}
          </div>
          <div
            className={cn(
              'font-mono tabular-nums text-base font-medium',
              !pnlKnown ? 'text-foreground' : isPnlPositive ? 'text-long' : 'text-short'
            )}
            title={!pnlKnown ? 'Price unavailable for some positions — PnL unknown' : undefined}
          >
            {pnlKnown
              ? `${isPnlPositive ? '+' : '-'}${formatUSD(Math.abs(totalUnrealizedPnl))}`
              : '—'}
          </div>
          <div className={cn(
            'flex items-center gap-1 mt-1 text-xs',
            !pnlKnown ? 'text-muted-foreground' : isPnlPositive ? 'text-long' : 'text-short'
          )}>
            {pnlKnown && (
              isPnlPositive ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )
            )}
            <span className="font-mono tabular-nums">
              {formatPercent(pnlPercent, 1)}
            </span>
          </div>
        </div>

        {/* Wallet Balance (was "Buying Power" — it is simply the wallet) */}
        <div className="rounded-lg border border-border bg-surface p-4 flex flex-col justify-center">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-faint mb-2">
            <Shield className="h-3.5 w-3.5" />
            <span>Wallet Balance</span>
          </div>
          <div className="font-mono tabular-nums text-base font-medium text-foreground">
            {formatUSD(buyingPower)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">USDC available to deposit or trade</div>
        </div>

        {/* Margin Ratio — the same formula and bands as /trade (B13) */}
        <div className="rounded-lg border border-border bg-surface p-4 flex flex-col justify-center">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-faint mb-2">
            <span>Margin Ratio</span>
            <span className="font-mono tabular-nums text-foreground">
              {marginRatio === null
                ? '—'
                : marginRatio === Infinity
                ? '--'
                : `${marginRatio.toFixed(0)}%`}
            </span>
          </div>
          {/* Bar fills TOWARD liquidation (full = liquidatable at 100%) */}
          <div className="h-1.5 bg-surface-2 rounded-sm overflow-hidden">
            <div
              className={cn(
                'h-full rounded-sm transition-colors',
                marginRatio !== null && marginRatio !== Infinity && marginRatio <= 100
                  ? 'bg-short'
                  : marginRatio !== null && marginRatio !== Infinity && marginRatio <= 300
                  ? 'bg-primary'
                  : 'bg-long'
              )}
              style={{ width: `${liqProximityPct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>
              {marginRatio === null
                ? '—'
                : marginRatio === Infinity
                ? 'No open margin'
                : marginRatio > 300
                ? 'Healthy'
                : marginRatio > 100
                ? 'Caution'
                : 'At Risk'}
            </span>
            <span className="font-mono tabular-nums" title="Maintenance margin (1% of open size)">
              {formatUSD(maintenanceMargin, 0)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
