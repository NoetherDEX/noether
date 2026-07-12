'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Info, Users, BarChart3, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Tooltip } from '@/components/ui';
import { formatNumber, formatUSD, truncateAddress } from '@/lib/utils/format';
import { STELLAR_EXPERT_BASE } from '@/lib/utils/constants';
import { useWalletStore } from '@/lib/store';
import { getLeaderboardData, type LeaderboardTrader } from '@/lib/stellar/leaderboard';

type SortField = 'totalVolume' | 'pnl';

const SORT_LABELS: Record<SortField, string> = {
  totalVolume: 'Volume',
  pnl: 'Realized PnL',
};

// What each ranking metric actually counts today (opens only / open-side
// notional / realized price-PnL) — shown in the column-header tooltips.
const COLUMN_DEFS = {
  trades: 'Positions opened. Closing a position is not counted as a trade yet.',
  volume:
    'Notional value of opened positions. Fee-tier volume counts both open and close, so it can read higher.',
  pnl: 'Realized PnL from closed positions, before funding and fees.',
} as const;

function PnlCell({ value, className }: { value: number; className?: string }) {
  // Exactly-zero renders neutral — green is reserved for real realized gains.
  if (value === 0) {
    return <span className={cn('font-mono tabular-nums text-xs text-muted-foreground', className)}>{formatUSD(0)}</span>;
  }
  const isPositive = value > 0;
  return (
    <span className={cn('font-mono tabular-nums text-xs', isPositive ? 'text-long' : 'text-short', className)}>
      {isPositive ? '+' : ''}{formatUSD(value)}
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border">
      {Array.from({ length: 5 }).map((_, i) => (
        <td key={i} className="py-2 px-4">
          <div className="h-4 bg-surface-2 rounded-sm animate-pulse" style={{ width: i === 1 ? '120px' : '60px' }} />
        </td>
      ))}
    </tr>
  );
}

export function LeaderboardContent() {
  const [traders, setTraders] = useState<LeaderboardTrader[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [sortBy, setSortBy] = useState<SortField>('pnl');
  const walletAddress = useWalletStore((s) => s.address);

  const fetchData = useCallback(async () => {
    try {
      const data = await getLeaderboardData();
      setTraders(data);
      setFetchFailed(false);
    } catch (error) {
      console.error('[Leaderboard] Failed to fetch:', error);
      // Keep last-good data — a failed refresh shows a stale banner, never a
      // fake-empty board.
      setFetchFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    // Refresh every 60 seconds
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  function handleRetry() {
    setLoading(true);
    fetchData();
  }

  const sorted = [...traders].sort((a, b) => {
    if (sortBy === 'pnl') return b.pnl - a.pnl;
    return b.totalVolume - a.totalVolume;
  });

  // Error with nothing to show: totals are unknown, not zero.
  const errorNoData = fetchFailed && traders.length === 0;
  const staleData = fetchFailed && traders.length > 0;

  const selfIdx = walletAddress ? sorted.findIndex((t) => t.address === walletAddress) : -1;
  const self = selfIdx >= 0 ? sorted[selfIdx] : null;

  const totalTraders = traders.length;
  const totalVolume = traders.reduce((sum, t) => sum + t.totalVolume, 0);
  const totalTrades = traders.reduce((sum, t) => sum + t.tradeCount, 0);

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-md bg-surface-2 flex items-center justify-center">
              <Users className="w-4 h-4 text-faint" />
            </div>
            <span className="text-[11px] text-faint uppercase tracking-wide">Traders</span>
          </div>
          <div className="text-xl font-medium font-mono tabular-nums">
            {loading ? <div className="h-7 w-12 bg-surface-2 rounded-sm animate-pulse" /> : errorNoData ? '—' : formatNumber(totalTraders, 0)}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-md bg-surface-2 flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-faint" />
            </div>
            <span className="text-[11px] text-faint uppercase tracking-wide">Total Volume</span>
          </div>
          <div className="text-xl font-medium font-mono tabular-nums">
            {loading ? <div className="h-7 w-24 bg-surface-2 rounded-sm animate-pulse" /> : errorNoData ? '—' : formatUSD(totalVolume, 0)}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-md bg-surface-2 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-faint" />
            </div>
            <span className="text-[11px] text-faint uppercase tracking-wide">Total Trades</span>
          </div>
          <div className="text-xl font-medium font-mono tabular-nums">
            {loading ? <div className="h-7 w-12 bg-surface-2 rounded-sm animate-pulse" /> : errorNoData ? '—' : formatNumber(totalTrades, 0)}
          </div>
        </div>
      </div>

      {/* Self-rank summary (A22): sticks below the fixed header while the
          table scrolls; hidden while loading or when rankings are unknown. */}
      {walletAddress && !loading && !errorNoData && (
        <div className="sticky top-16 z-20 rounded-lg bg-background">
          {/* Quiet primary-tinted highlight marks the connected trader's own row */}
          <div className="rounded-lg border border-primary/40 bg-primary/5 px-5 py-3.5 flex flex-wrap items-center gap-x-5 gap-y-2">
            {self ? (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-faint">
                    Your rank
                  </span>
                  <span className="font-mono text-lg font-medium tabular-nums text-foreground leading-none">
                    #{selfIdx + 1}
                  </span>
                </div>
                <span className="hidden sm:block h-5 w-px bg-border" aria-hidden="true" />
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-faint">Volume</span>
                  <span className="font-mono text-xs font-medium tabular-nums text-foreground">
                    {formatUSD(self.totalVolume, 0)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-faint">PnL</span>
                  <PnlCell value={self.pnl} className="text-xs font-medium" />
                </div>
              </>
            ) : (
              <>
                <span className="text-sm font-medium text-foreground">You&apos;re not ranked yet</span>
                <Link
                  href="/trade"
                  className="text-sm font-medium text-primary hover:opacity-80 transition-opacity"
                >
                  Make your first trade →
                </Link>
              </>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        {/* Table header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-[13px] font-medium">Rankings</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Ranked by:</span>
            {(['totalVolume', 'pnl'] as const).map((field) => (
              <button
                key={field}
                onClick={() => setSortBy(field)}
                aria-pressed={sortBy === field}
                className={cn(
                  'px-2.5 py-1 rounded-sm text-xs font-medium transition-colors',
                  sortBy === field
                    ? 'bg-surface-3 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {SORT_LABELS[field]}
              </button>
            ))}
          </div>
        </div>

        {/* Stale banner: a background refresh failed but we still have data */}
        {staleData && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-primary bg-primary/10 border-b border-primary/20"
          >
            <span>Live refresh failed — showing the last loaded rankings.</span>
            <button onClick={handleRetry} className="font-medium underline hover:opacity-80">
              Retry
            </button>
          </div>
        )}

        {!loading && errorNoData ? (
          /* Error ≠ empty: an outage never renders as "No traders yet" */
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground mb-4">Couldn&apos;t load rankings.</p>
            <button
              onClick={handleRetry}
              className="px-4 py-2 rounded-md bg-surface-2 hover:bg-surface-3 text-sm font-medium text-foreground transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
        <>
        {/* Desktop Table */}
        <div className="hidden sm:block overflow-x-auto" aria-busy={loading}>
          <table className="w-full">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-faint border-b border-border">
                <th scope="col" className="text-left py-2 px-4 font-medium w-14">
                  <span aria-hidden="true">#</span>
                  <span className="sr-only">Rank</span>
                </th>
                <th scope="col" className="text-left py-2 px-4 font-medium">Wallet</th>
                <th scope="col" className="text-right py-2 px-4 font-medium">
                  <span className="inline-flex items-center gap-1">
                    Trades
                    <Tooltip content={COLUMN_DEFS.trades}>
                      <Info className="w-3 h-3 text-faint" />
                    </Tooltip>
                  </span>
                </th>
                <th scope="col" className="text-right py-2 px-4 font-medium">
                  <span className="inline-flex items-center gap-1">
                    Volume
                    <Tooltip content={COLUMN_DEFS.volume}>
                      <Info className="w-3 h-3 text-faint" />
                    </Tooltip>
                  </span>
                </th>
                <th scope="col" className="text-right py-2 px-4 font-medium">
                  <span className="inline-flex items-center gap-1">
                    Realized PnL
                    <Tooltip content={COLUMN_DEFS.pnl}>
                      <Info className="w-3 h-3 text-faint" />
                    </Tooltip>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center">
                    <p className="text-sm text-muted-foreground mb-3">No traders yet. Be the first to open a position!</p>
                    <Link
                      href="/trade"
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:opacity-80 transition-colors"
                    >
                      Start trading →
                    </Link>
                  </td>
                </tr>
              ) : (
                sorted.map((trader, idx) => (
                    <tr
                      key={trader.address}
                      className={cn(
                        'border-b border-border last:border-0 transition-colors',
                        trader.address === walletAddress
                          ? 'border-primary/40 bg-primary/5 hover:bg-primary/10'
                          : 'hover:bg-surface-3/50'
                      )}
                    >
                      <td className="py-2 px-4">
                        <span className={cn('font-mono tabular-nums text-xs', idx === 0 ? 'text-primary' : idx < 3 ? 'text-muted-foreground' : 'text-faint')}>{idx + 1}</span>
                      </td>
                      <td className="py-2 px-4">
                        <a
                          href={`${STELLAR_EXPERT_BASE}/account/${trader.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs text-foreground hover:text-primary hover:underline transition-colors cursor-pointer"
                        >
                          {truncateAddress(trader.address, 4, 4)}
                        </a>
                        {trader.address === walletAddress && (
                          <span className="ml-2 text-[10px] font-medium text-primary">(you)</span>
                        )}
                      </td>
                      <td className="py-2 px-4 text-right">
                        <span className="font-mono tabular-nums text-xs text-muted-foreground">{trader.tradeCount}</span>
                      </td>
                      <td className="py-2 px-4 text-right">
                        <span className="font-mono tabular-nums text-xs text-muted-foreground">{formatUSD(trader.totalVolume, 0)}</span>
                      </td>
                      <td className="py-2 px-4 text-right">
                        <PnlCell value={trader.pnl} />
                      </td>
                    </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="sm:hidden" aria-busy={loading}>
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-20 bg-surface-2 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground mb-3">No traders yet. Be the first to open a position!</p>
              <Link
                href="/trade"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:opacity-80 transition-colors"
              >
                Start trading →
              </Link>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {sorted.map((trader, idx) => (
                <div
                  key={trader.address}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-lg',
                    trader.address === walletAddress
                      ? 'bg-primary/5 border border-primary/40'
                      : 'bg-surface-2 border border-border'
                  )}
                >
                  <span className={cn('font-mono tabular-nums text-xs w-6 text-center flex-shrink-0', idx === 0 ? 'text-primary' : idx < 3 ? 'text-muted-foreground' : 'text-faint')}>
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <a
                      href={`${STELLAR_EXPERT_BASE}/account/${trader.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-foreground hover:text-primary transition-colors"
                    >
                      {truncateAddress(trader.address, 4, 4)}
                    </a>
                    {trader.address === walletAddress && (
                      <span className="ml-1.5 text-[10px] font-medium text-primary">(you)</span>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-xs text-faint">
                      <span className="font-mono tabular-nums">{trader.tradeCount} trades</span>
                      <span className="font-mono tabular-nums">{formatUSD(trader.totalVolume, 0)}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <PnlCell value={trader.pnl} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
}
