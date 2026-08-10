export interface LeaderboardTrader {
  /** Position on the FULL ranked board (1 based), not the row's index on
   *  the current page. */
  rank: number;
  address: string;
  tradeCount: number;
  totalVolume: number;
  pnl: number;
  /** Liquidations suffered. >0 flags that PnL is INCOMPLETE (the deployed
   *  isolated liq event carries no loss figure until the C2 enrichment). */
  liqCount?: number;
  /** Index freshness stamp (unix seconds) for the "Updated Xm ago" indicator. */
  lastUpdated?: number | null;
}

/** 'not_indexed_here' means this build's scope lives on another Stellar
 *  network than the gateway serves; 'empty' means the venue has no traders
 *  yet (mainnet before launch). Both render a scope aware empty state. */
export type LeaderboardState = 'ok' | 'empty' | 'not_indexed_here';

export type LeaderboardSort = 'pnl' | 'volume';

export interface LeaderboardPageData {
  scope: string;
  state: LeaderboardState;
  sort: LeaderboardSort;
  /** Distinct traders on the full board, not just this page. */
  total: number;
  limit: number;
  offset: number;
  /** Immutable board snapshot id; pass it back with the next offset so
   *  ranks stay stable while paging. */
  snapshot: string;
  snapshotChanged: boolean;
  updatedAt: number | null;
  leaders: LeaderboardTrader[];
}

/** Market wide headline totals, counted across every trader (not just the page). */
export interface LeaderboardTotals {
  traders: number;
  trades: number;
  /** USD, already descaled from 7 decimal fixed point. */
  volume: number;
  lastUpdated?: number | null;
}

export interface LeaderboardSelfRank {
  rank: number | null;
  total: number;
  state: LeaderboardState;
  entry: LeaderboardTrader | null;
}

/**
 * One server ranked page of the board. Ranking, tie breaks, scoping and
 * pagination all happen gateway side; the PnL view is a true PnL ranking
 * over every trader, not a client resort of the top volume page.
 * Throws on any failure so an outage surfaces as an error state, never as
 * a fake empty board. Callers keep last good data.
 */
export async function getLeaderboardPage(opts: {
  sort: LeaderboardSort;
  offset: number;
  limit?: number;
  snapshot?: string;
}): Promise<LeaderboardPageData> {
  const qs = new URLSearchParams({
    sort: opts.sort,
    offset: String(opts.offset),
    limit: String(opts.limit ?? 20),
  });
  if (opts.snapshot) qs.set('snapshot', opts.snapshot);
  const res = await fetch(`/api/leaderboard?${qs.toString()}`);
  if (!res.ok) {
    throw new Error(`Leaderboard request failed (${res.status})`);
  }
  const data = await res.json();
  if (!Array.isArray(data?.leaders) || typeof data?.total !== 'number') {
    throw new Error('Leaderboard response was malformed');
  }
  return data as LeaderboardPageData;
}

/**
 * Totals for the stat tiles. Aggregated server side over every trader, and
 * scoped like the board. Throws on failure so the caller can fall back to
 * the (undercounted) row sum rather than rendering a fabricated zero.
 */
export async function getLeaderboardTotals(): Promise<LeaderboardTotals> {
  const res = await fetch('/api/leaderboard/totals');
  if (!res.ok) {
    throw new Error(`Leaderboard totals request failed (${res.status})`);
  }
  const data = await res.json();
  if (typeof data?.traders !== 'number' || typeof data?.volume !== 'number') {
    throw new Error('Leaderboard totals response was malformed');
  }
  return data as LeaderboardTotals;
}

/**
 * The connected wallet's rank on the FULL board. The visible page holds at
 * most one page of rows, so a wallet below the fold would otherwise read as
 * unranked. Resolved against the same snapshot the pages slice.
 */
export async function getLeaderboardRank(
  trader: string,
  sort: LeaderboardSort,
): Promise<LeaderboardSelfRank> {
  const qs = new URLSearchParams({ trader, sort });
  const res = await fetch(`/api/leaderboard/rank?${qs.toString()}`);
  if (!res.ok) {
    throw new Error(`Leaderboard rank request failed (${res.status})`);
  }
  const data = await res.json();
  if (typeof data?.total !== 'number') {
    throw new Error('Leaderboard rank response was malformed');
  }
  return data as LeaderboardSelfRank;
}
