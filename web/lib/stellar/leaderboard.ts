export interface LeaderboardTrader {
  address: string;
  tradeCount: number;
  totalVolume: number;
  pnl: number;
}

export async function getLeaderboardData(): Promise<LeaderboardTrader[]> {
  const res = await fetch('/api/leaderboard');
  if (!res.ok) return [];
  return res.json();
}
