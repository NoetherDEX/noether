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
