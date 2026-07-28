export interface LeaderboardTrader {
  address: string;
  tradeCount: number;
  totalVolume: number;
  pnl: number;
  /** Liquidations suffered. >0 flags that PnL is INCOMPLETE — the deployed
   *  isolated-liq event carries no loss figure until the C2 enrichment. */
  liqCount?: number;
  /** Index freshness stamp (unix seconds) for the "Updated Xm ago" indicator. */
  lastUpdated?: number | null;
}

/** Market-wide headline totals, counted across every trader (not just the page). */
export interface LeaderboardTotals {
  traders: number;
  trades: number;
  /** USD, already descaled from 7-dec fixed point. */
  volume: number;
  lastUpdated?: number | null;
}

/**
 * Totals for the stat tiles. Aggregated server-side over every trader —
 * summing the row page undercounts once the board outgrows its 200-row limit.
 * Throws on failure so the caller can fall back to the (undercounted) row sum
 * rather than rendering a fabricated zero.
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

// Throws on any failure — an outage must surface as an error state, never as
// an empty (fake "No traders yet") board. Callers keep last-good data.
export async function getLeaderboardData(): Promise<LeaderboardTrader[]> {
  const res = await fetch('/api/leaderboard');
  if (!res.ok) {
    throw new Error(`Leaderboard request failed (${res.status})`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error('Leaderboard response was not a list');
  }
  return data;
}
