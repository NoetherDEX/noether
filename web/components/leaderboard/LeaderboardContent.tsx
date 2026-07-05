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
    return <span className={cn('font-mono text-sm text-white/60', className)}>{formatUSD(0)}</span>;
  }
  const isPositive = value > 0;
  return (
    <span className={cn('font-mono text-sm', isPositive ? 'text-[#22c55e]' : 'text-[#ef4444]', className)}>
      {isPositive ? '+' : ''}{formatUSD(value)}
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-white/5">
      {Array.from({ length: 5 }).map((_, i) => (
        <td key={i} className="py-3 px-4">
          <div className="h-4 bg-white/[0.06] rounded animate-pulse" style={{ width: i === 1 ? '120px' : '60px' }} />
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
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-white/[0.06] flex items-center justify-center">
              <Users className="w-4 h-4 text-white/40" />
            </div>
            <span className="text-xs text-white/60 uppercase tracking-wider">Traders</span>
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums">
            {loading ? <div className="h-7 w-12 bg-white/[0.06] rounded animate-pulse" /> : errorNoData ? '—' : formatNumber(totalTraders, 0)}
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-white/[0.06] flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-white/40" />
            </div>
            <span className="text-xs text-white/60 uppercase tracking-wider">Total Volume</span>
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums">
            {loading ? <div className="h-7 w-24 bg-white/[0.06] rounded animate-pulse" /> : errorNoData ? '—' : formatUSD(totalVolume, 0)}
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-white/[0.06] flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-white/40" />
            </div>
            <span className="text-xs text-white/60 uppercase tracking-wider">Total Trades</span>
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums">
            {loading ? <div className="h-7 w-12 bg-white/[0.06] rounded animate-pulse" /> : errorNoData ? '—' : formatNumber(totalTrades, 0)}
          </div>
        </div>
      </div>

      {/* Self-rank summary (A22): sticks below the fixed header while the
          table scrolls; hidden while loading or when rankings are unknown. */}
      {walletAddress && !loading && !errorNoData && (
        <div className="sticky top-16 z-20 rounded-xl bg-[#0a0a0a]">
          <div className="rounded-xl border border-[#eab308]/25 bg-[#eab308]/[0.06] px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            {self ? (
              <>
                <span className="text-sm font-semibold text-[#eab308]">
                  Your rank: #{selfIdx + 1}
                </span>
                <span className="text-xs text-white/60">
                  <span className="font-mono text-white/80">{formatUSD(self.totalVolume, 0)}</span> volume
                  <span className="mx-1.5 text-white/30">·</span>
                  <PnlCell value={self.pnl} className="text-xs" /> PnL
                </span>
              </>
            ) : (
              <>
                <span className="text-sm font-medium text-white/80">Not ranked yet</span>
                <Link
                  href="/trade"
                  className="text-xs font-medium text-[#eab308] hover:text-[#facc15] transition-colors"
                >
                  Make your first trade →
                </Link>
              </>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0a0a0a] overflow-hidden">
        {/* Table header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <h3 className="text-sm font-semibold">Rankings</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/60">Ranked by:</span>
            {(['totalVolume', 'pnl'] as const).map((field) => (
              <button
                key={field}
                onClick={() => setSortBy(field)}
                aria-pressed={sortBy === field}
                className={cn(
                  'px-2.5 py-1 rounded text-xs font-medium transition-colors',
                  sortBy === field
                    ? 'bg-white/10 text-white'
                    : 'text-white/60 hover:text-white/80'
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
            className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-[#f59e0b] bg-[#f59e0b]/10 border-b border-[#f59e0b]/20"
          >
            <span>Live refresh failed — showing the last loaded rankings.</span>
            <button onClick={handleRetry} className="font-medium underline hover:text-[#fbbf24]">
              Retry
            </button>
          </div>
        )}

        {!loading && errorNoData ? (
          /* Error ≠ empty: an outage never renders as "No traders yet" */
          <div className="py-16 text-center">
            <p className="text-sm text-white/60 mb-4">Couldn&apos;t load rankings.</p>
            <button
              onClick={handleRetry}
              className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-medium text-white transition-colors"
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
              <tr className="text-xs text-white/60 border-b border-white/5">
                <th scope="col" className="text-left py-3 px-4 font-medium w-14">
                  <span aria-hidden="true">#</span>
                  <span className="sr-only">Rank</span>
                </th>
                <th scope="col" className="text-left py-3 px-4 font-medium">Wallet</th>
                <th scope="col" className="text-right py-3 px-4 font-medium">
                  <span className="inline-flex items-center gap-1">
                    Trades
                    <Tooltip content={COLUMN_DEFS.trades}>
                      <Info className="w-3 h-3 text-white/40" />
                    </Tooltip>
                  </span>
                </th>
                <th scope="col" className="text-right py-3 px-4 font-medium">
                  <span className="inline-flex items-center gap-1">
                    Volume
                    <Tooltip content={COLUMN_DEFS.volume}>
                      <Info className="w-3 h-3 text-white/40" />
                    </Tooltip>
                  </span>
                </th>
                <th scope="col" className="text-right py-3 px-4 font-medium">
                  <span className="inline-flex items-center gap-1">
                    Realized PnL
                    <Tooltip content={COLUMN_DEFS.pnl}>
                      <Info className="w-3 h-3 text-white/40" />
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
                    <p className="text-sm text-white/50 mb-3">No traders yet. Be the first to open a position!</p>
                    <Link
                      href="/trade"
                      className="inline-flex items-center gap-1 text-sm font-medium text-[#eab308] hover:text-[#facc15] transition-colors"
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
                        'border-b border-white/5 last:border-0 transition-colors',
                        trader.address === walletAddress
                          ? 'bg-[#eab308]/[0.06] hover:bg-[#eab308]/[0.08]'
                          : 'hover:bg-white/[0.02]'
                      )}
                    >
                      <td className="py-3 px-4">
                        <span className="font-mono text-sm text-white/50">{idx + 1}</span>
                      </td>
                      <td className="py-3 px-4">
                        <a
                          href={`${STELLAR_EXPERT_BASE}/account/${trader.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-sm text-blue-400 hover:text-blue-300 hover:underline transition-colors cursor-pointer"
                        >
                          {truncateAddress(trader.address, 4, 4)}
                        </a>
                        {trader.address === walletAddress && (
                          <span className="ml-2 text-[10px] font-medium text-[#eab308]">(you)</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="font-mono text-sm text-white/60">{trader.tradeCount}</span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="font-mono text-sm text-white/60">{formatUSD(trader.totalVolume, 0)}</span>
                      </td>
                      <td className="py-3 px-4 text-right">
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
                <div key={i} className="h-20 bg-white/[0.03] rounded-lg animate-pulse" />
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-white/50 mb-3">No traders yet. Be the first to open a position!</p>
              <Link
                href="/trade"
                className="inline-flex items-center gap-1 text-sm font-medium text-[#eab308] hover:text-[#facc15] transition-colors"
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
                      ? 'bg-[#eab308]/[0.06] border border-[#eab308]/25'
                      : 'bg-white/[0.02] border border-white/5'
                  )}
                >
                  <span className="font-mono text-sm text-white/40 w-6 text-center flex-shrink-0">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <a
                      href={`${STELLAR_EXPERT_BASE}/account/${trader.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      {truncateAddress(trader.address, 4, 4)}
                    </a>
                    {trader.address === walletAddress && (
                      <span className="ml-1.5 text-[10px] font-medium text-[#eab308]">(you)</span>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-xs text-white/40">
                      <span>{trader.tradeCount} trades</span>
                      <span>{formatUSD(trader.totalVolume, 0)}</span>
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
