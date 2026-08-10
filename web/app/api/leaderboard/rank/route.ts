import { NextResponse, type NextRequest } from 'next/server';
import { apiBase } from '@/lib/api/base';
import { leaderboardScope } from '@/lib/api/scope';

export const dynamic = 'force-dynamic';

/**
 * Rank lookup for the connected wallet's "Your rank" banner. The board
 * itself is paginated, so the wallet's row is usually not on the visible
 * page; the gateway resolves rank and total against the same snapshot the
 * pages slice. Scoped like the row proxy so a mainnet build can never rank
 * a wallet against testnet history.
 */

interface GatewayEntry {
  rank: number;
  trader: string;
  /** 7 decimal fixed point strings. */
  pnl: string;
  volume: string;
  trades: number;
  liqCount: number;
}

interface GatewayRank {
  trader: string;
  sort: string;
  scope: string;
  network: string;
  state: string;
  rank: number | null;
  total: number;
  snapshot: string;
  updatedAt: number | null;
  entry: GatewayEntry | null;
}

const SCALE = 10_000_000;

export async function GET(request: NextRequest) {
  const trader = request.nextUrl.searchParams.get('trader');
  if (!trader) {
    return NextResponse.json({ error: 'trader_required' }, { status: 400 });
  }
  try {
    const base = apiBase();
    const sort = request.nextUrl.searchParams.get('sort') === 'volume' ? 'volume' : 'pnl';
    const qs = new URLSearchParams({ trader, sort, scope: leaderboardScope() });
    const res = await fetch(`${base}/v1/leaderboard/rank?${qs.toString()}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) {
      throw new Error(`gateway responded ${res.status}`);
    }
    const data = (await res.json()) as GatewayRank;
    return NextResponse.json(
      {
        trader: data.trader,
        sort: data.sort,
        scope: data.scope,
        state: data.state,
        rank: data.rank,
        total: data.total,
        entry: data.entry
          ? {
              rank: data.entry.rank,
              address: data.entry.trader,
              tradeCount: data.entry.trades,
              totalVolume: Number(data.entry.volume) / SCALE,
              pnl: Number(data.entry.pnl) / SCALE,
              liqCount: data.entry.liqCount ?? 0,
              lastUpdated: data.updatedAt ?? null,
            }
          : null,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } },
    );
  } catch (error) {
    console.error('[Leaderboard] rank proxy error:', error);
    return NextResponse.json({ error: 'rank_unavailable' }, { status: 500 });
  }
}
