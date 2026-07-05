export interface LeaderboardTrader {
  address: string;
  tradeCount: number;
  totalVolume: number;
  pnl: number;
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
