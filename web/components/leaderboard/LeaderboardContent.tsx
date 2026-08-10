'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Info, Users, BarChart3, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Tooltip } from '@/components/ui';
import { formatNumber, formatUSD, formatRelativeTime, truncateAddress } from '@/lib/utils/format';
import { STELLAR_EXPERT_BASE } from '@/lib/utils/constants';
import { useWalletStore } from '@/lib/store';
import {
  getLeaderboardPage,
  getLeaderboardRank,
  getLeaderboardTotals,
  type LeaderboardPageData,
  type LeaderboardSelfRank,
  type LeaderboardSort,
  type LeaderboardTotals,
} from '@/lib/stellar/leaderboard';

/** Server side page size: 20 rows per page with previous/next controls. */
const PAGE_SIZE = 20;

const SORT_LABELS: Record<LeaderboardSort, string> = {
  volume: 'Volume',
  pnl: 'Realized PnL',
};

// What each ranking metric actually counts today — shown in the
// column-header tooltips. Live numbers come from the indexer (current
// market deployment) merged with the pre-July-2026 legacy baseline.
const COLUMN_DEFS = {
  trades: 'Positions opened (live market + legacy history). Closing a position is not counted as a trade.',
  volume:
    'Notional traded on the live market — opens plus closes, matching the fee-tier definition — plus legacy open-side volume from before July 2026.',
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

/** B2: flags accounts whose PnL is INCOMPLETE — the deployed isolated-liq
 *  event carries no loss figure, so a blown account would otherwise rank as
 *  break-even. Cross-account liquidation losses ARE counted (cross_liq
 *  carries total_pnl); this marks the remainder honestly. */
function LiqFlag({ count }: { count: number }) {
  return (
    <Tooltip
      content={`${count} liquidation${count === 1 ? '' : 's'} — isolated-liq losses aren't included in PnL yet (the on-chain event doesn't report them until the next contract deploy).`}
    >
      <span className="text-[10px] font-medium text-short border border-short/30 bg-short/10 rounded-sm px-1 whitespace-nowrap">
        {count}× liq
      </span>
    </Tooltip>
  );
}

function RankCell({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        'font-mono tabular-nums text-xs',
        rank === 1 ? 'text-primary' : rank <= 3 ? 'text-muted-foreground' : 'text-faint'
      )}
    >
      {rank}
    </span>
  );
}

/** Scope aware empty board: the mainnet venue is genuinely empty until
 *  launch, and inviting people to trade there would be a dead end. */
function EmptyBoard({ scope }: { scope: string }) {
  if (scope === 'mainnet') {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted-foreground mb-1.5">Mainnet trading has not started yet.</p>
        <p className="text-xs text-faint">The mainnet leaderboard starts counting with the first mainnet trade.</p>
      </div>
    );
  }
  return (
    <div className="py-16 text-center">
      <p className="text-sm text-muted-foreground mb-3">No traders yet. Be the first to open a position!</p>
      <Link
        href="/trade"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:opacity-80 transition-colors"
      >
        Start trading →
      </Link>
    </div>
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

const PAGE_BUTTON_CLASS =
  'px-2.5 py-1 rounded-sm text-xs font-medium transition-colors bg-surface-2 text-foreground ' +
  'hover:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface-2';

interface PageView {
  sort: LeaderboardSort;
  offset: number;
  snapshot?: string;
}

export function LeaderboardContent() {
  const [data, setData] = useState<LeaderboardPageData | null>(null);
  const [totals, setTotals] = useState<LeaderboardTotals | null>(null);
  const [selfRank, setSelfRank] = useState<LeaderboardSelfRank | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [sortBy, setSortBy] = useState<LeaderboardSort>('pnl');
  const walletAddress = useWalletStore((s) => s.address);

  // The current view, readable from the refresh interval without re arming
  // the timer on every page turn.
  const viewRef = useRef<PageView>({ sort: 'pnl', offset: 0 });

  const fetchData = useCallback(async (view: PageView, opts?: { showSkeleton?: boolean }) => {
    if (opts?.showSkeleton) setLoading(true);
    // The ranked rows and the headline totals are independent reads: the rows
    // are one server ranked page, the totals are aggregated across every
    // trader. Fetch both, and let each degrade on its own.
    const [rows, agg] = await Promise.allSettled([
      getLeaderboardPage({
        sort: view.sort,
        offset: view.offset,
        limit: PAGE_SIZE,
        snapshot: view.snapshot,
      }),
      getLeaderboardTotals(),
    ]);

    if (rows.status === 'fulfilled') {
      setData(rows.value);
      viewRef.current = {
        sort: rows.value.sort === 'volume' ? 'volume' : 'pnl',
        offset: rows.value.offset,
        snapshot: rows.value.snapshot,
      };
      setFetchFailed(false);
    } else {
      console.error('[Leaderboard] Failed to fetch:', rows.reason);
      // Keep last-good data — a failed refresh shows a stale banner, never a
      // fake-empty board.
      setFetchFailed(true);
    }

    if (agg.status === 'fulfilled') {
      setTotals(agg.value);
    } else {
      // Keep last good totals; the tiles fall back to the board total,
      // which never invents a number.
      console.error('[Leaderboard] Failed to fetch totals:', agg.reason);
    }

    setLoading(false);
  }, []);

  // Initial load, and back to page one on every sort change (a new sort is
  // a new ranking, so a carried offset or snapshot would be meaningless).
  useEffect(() => {
    fetchData({ sort: sortBy, offset: 0 }, { showSkeleton: true });
  }, [sortBy, fetchData]);

  // Background refresh every 60 seconds: refetch the current view WITHOUT a
  // snapshot pin so it adopts the newest board.
  useEffect(() => {
    const interval = setInterval(() => {
      const v = viewRef.current;
      fetchData({ sort: v.sort, offset: v.offset });
    }, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // The wallet's own rank comes from the FULL board via the rank endpoint;
  // with 20 row pages the wallet's row is usually below the fold.
  useEffect(() => {
    if (!walletAddress) {
      setSelfRank(null);
      return;
    }
    let cancelled = false;
    getLeaderboardRank(walletAddress, sortBy)
      .then((r) => {
        if (!cancelled) setSelfRank(r);
      })
      .catch((err) => {
        console.error('[Leaderboard] Failed to fetch self rank:', err);
        // Unknown is not "unranked": hide the banner rather than guess.
        if (!cancelled) setSelfRank(null);
      });
    return () => {
      cancelled = true;
    };
  }, [walletAddress, sortBy, data?.snapshot]);

  function handleRetry() {
    const v = viewRef.current;
    fetchData({ sort: v.sort, offset: v.offset }, { showSkeleton: true });
  }

  // Page moves carry the current snapshot id so ranks stay stable and rows
  // never duplicate or vanish across the boundary.
  function goToOffset(offset: number) {
    fetchData({ sort: sortBy, offset, snapshot: data?.snapshot }, { showSkeleton: true });
  }

  const traders = data?.leaders ?? [];
  const scope = data?.scope ?? 'testnet';
  const offset = data?.offset ?? 0;
  const total = data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + traders.length < total;

  // Error with nothing to show: totals are unknown, not zero.
  const errorNoData = fetchFailed && !data;
  // Tiles only go blank when neither source can answer: server totals survive a
  // failed row fetch, since they are an independent read.
  const totalsUnknown = errorNoData && !totals;
  const staleData = fetchFailed && data !== null;

  // Index freshness: rankings update via the indexer, not live. Show WHEN
  // they were computed; amber past 10 minutes (B2).
  const syncedAtMs = (data?.updatedAt ?? 0) * 1000;
  const syncIsStale = syncedAtMs > 0 && Date.now() - syncedAtMs > 10 * 60 * 1000;

  // Prefer the server side aggregate: the rows are one page of the board,
  // so summing them undercounts everything beyond it.
  const totalTraders = totals?.traders ?? total;
  const totalVolume = totals?.volume ?? traders.reduce((sum, t) => sum + t.totalVolume, 0);
  const totalTrades = totals?.trades ?? traders.reduce((sum, t) => sum + t.tradeCount, 0);

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
            {loading ? <div className="h-7 w-12 bg-surface-2 rounded-sm animate-pulse" /> : totalsUnknown ? '—' : formatNumber(totalTraders, 0)}
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
            {loading ? <div className="h-7 w-24 bg-surface-2 rounded-sm animate-pulse" /> : totalsUnknown ? '—' : formatUSD(totalVolume, 0)}
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
            {loading ? <div className="h-7 w-12 bg-surface-2 rounded-sm animate-pulse" /> : totalsUnknown ? '—' : formatNumber(totalTrades, 0)}
          </div>
        </div>
      </div>

      {/* Self rank summary (A22): resolved against the FULL board, so it is
          right even when the connected wallet is not on the visible page.
          Hidden while loading, on error, and when the rank read failed. */}
      {walletAddress && !loading && !errorNoData && selfRank && (
        <div className="sticky top-16 z-20 rounded-lg bg-background">
          {/* Quiet primary-tinted highlight marks the connected trader's own row */}
          <div className="rounded-lg border border-primary/40 bg-primary/5 px-5 py-3.5 flex flex-wrap items-center gap-x-5 gap-y-2">
            {selfRank.rank !== null && selfRank.entry ? (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-faint">
                    Your rank
                  </span>
                  <span className="font-mono text-lg font-medium tabular-nums text-foreground leading-none">
                    #{selfRank.rank}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-faint">
                    of {formatNumber(selfRank.total, 0)}
                  </span>
                </div>
                <span className="hidden sm:block h-5 w-px bg-border" aria-hidden="true" />
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-faint">Volume</span>
                  <span className="font-mono text-xs font-medium tabular-nums text-foreground">
                    {formatUSD(selfRank.entry.totalVolume, 0)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-faint">PnL</span>
                  <PnlCell value={selfRank.entry.pnl} className="text-xs font-medium" />
                </div>
              </>
            ) : (
              <>
                <span className="text-sm font-medium text-foreground">You&apos;re not ranked yet</span>
                {scope !== 'mainnet' && (
                  <Link
                    href="/trade"
                    className="text-sm font-medium text-primary hover:opacity-80 transition-opacity"
                  >
                    Make your first trade →
                  </Link>
                )}
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
            {(['volume', 'pnl'] as const).map((field) => (
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

        {/* Sync freshness: rankings come from the indexer, not live (B2) */}
        {!loading && !errorNoData && syncedAtMs > 0 && (
          <div
            className={cn(
              'flex items-center gap-1.5 px-4 py-1.5 text-[11px] border-b border-border',
              syncIsStale ? 'text-primary' : 'text-faint'
            )}
          >
            <span
              className={cn(
                'inline-block h-1.5 w-1.5 rounded-full',
                syncIsStale ? 'bg-primary' : 'bg-long'
              )}
              aria-hidden="true"
            />
            Updated {formatRelativeTime(syncedAtMs)}
            {syncIsStale && <span>— sync may be delayed</span>}
          </div>
        )}

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
              ) : traders.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyBoard scope={scope} />
                  </td>
                </tr>
              ) : (
                traders.map((trader) => (
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
                        <RankCell rank={trader.rank} />
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
                        <span className="inline-flex items-center gap-1.5">
                          {(trader.liqCount ?? 0) > 0 && <LiqFlag count={trader.liqCount!} />}
                          <PnlCell value={trader.pnl} />
                        </span>
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
          ) : traders.length === 0 ? (
            <EmptyBoard scope={scope} />
          ) : (
            <div className="p-3 space-y-2">
              {traders.map((trader) => (
                <div
                  key={trader.address}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-lg',
                    trader.address === walletAddress
                      ? 'bg-primary/5 border border-primary/40'
                      : 'bg-surface-2 border border-border'
                  )}
                >
                  <span className="w-6 text-center flex-shrink-0">
                    <RankCell rank={trader.rank} />
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
                  <div className="text-right flex-shrink-0 flex items-center gap-1.5">
                    {(trader.liqCount ?? 0) > 0 && <LiqFlag count={trader.liqCount!} />}
                    <PnlCell value={trader.pnl} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination: previous/next over the server ranked board */}
        {!loading && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-border">
            <span className="text-xs text-faint font-mono tabular-nums">
              Showing {formatNumber(offset + 1, 0)} to {formatNumber(offset + traders.length, 0)} of {formatNumber(total, 0)}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => goToOffset(Math.max(0, offset - PAGE_SIZE))}
                disabled={!hasPrev}
                aria-label="Previous page"
                className={PAGE_BUTTON_CLASS}
              >
                Previous
              </button>
              <button
                onClick={() => goToOffset(offset + PAGE_SIZE)}
                disabled={!hasNext}
                aria-label="Next page"
                className={PAGE_BUTTON_CLASS}
              >
                Next
              </button>
            </div>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}
