import { NextResponse, type NextRequest } from 'next/server';
import { apiBase } from '@/lib/api/base';
import { leaderboardScope } from '@/lib/api/scope';

export const dynamic = 'force-dynamic';

/**
 * Thin server side proxy to the gateway's durable leaderboard
 * (indexer → Postgres → /v1/leaderboard).
 *
 * Forwards the page controls (sort, limit, offset, snapshot) and pins the
 * scope to this build's deployment scope, so the mainnet site can never
 * read testnet rows through the shared gateway. Ranking, tie breaks and
 * pagination all happen server side; each returned row carries its `rank`
 * on the full board.
 */

interface GatewayLeader {
  rank: number;
  trader: string;
  /** 7 decimal fixed point strings. */
  pnl: string;
  volume: string;
  trades: number;
  liqCount: number;
}

interface GatewayBoard {
  sort: string;
  scope: string;
  network: string;
  state: string;
  updatedAt: number | null;
  total: number;
  limit: number;
  offset: number;
  snapshot: string;
  snapshotChanged: boolean;
  leaders: GatewayLeader[];
}

const SCALE = 10_000_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export async function GET(request: NextRequest) {
  try {
    const base = apiBase();
    const params = request.nextUrl.searchParams;
    const sort = params.get('sort') === 'volume' ? 'volume' : 'pnl';
    const limit = clampInt(params.get('limit'), 1, MAX_LIMIT, DEFAULT_LIMIT);
    const offset = clampInt(params.get('offset'), 0, 1_000_000, 0);
    const snapshot = params.get('snapshot') ?? '';

    const qs = new URLSearchParams({
      scope: leaderboardScope(),
      sort,
      limit: String(limit),
      offset: String(offset),
    });
    if (snapshot) qs.set('snapshot', snapshot);

    const res = await fetch(`${base}/v1/leaderboard?${qs.toString()}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) {
      throw new Error(`gateway responded ${res.status}`);
    }
    const board = (await res.json()) as GatewayBoard;
    if (!Array.isArray(board.leaders)) {
      throw new Error('gateway leaderboard shape unexpected');
    }

    return NextResponse.json(
      {
        scope: board.scope,
        state: board.state,
        sort: board.sort,
        total: board.total,
        limit: board.limit,
        offset: board.offset,
        snapshot: board.snapshot,
        snapshotChanged: board.snapshotChanged,
        // Index freshness stamp (unix seconds), letting the UI show
        // "Updated Xm ago" instead of presenting stale rankings as live.
        updatedAt: board.updatedAt ?? null,
        leaders: board.leaders.map((l) => ({
          rank: l.rank,
          address: l.trader,
          tradeCount: l.trades,
          totalVolume: Number(l.volume) / SCALE,
          pnl: Number(l.pnl) / SCALE,
          liqCount: l.liqCount ?? 0,
          lastUpdated: board.updatedAt ?? null,
        })),
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        },
      },
    );
  } catch (error) {
    console.error('[Leaderboard] gateway proxy error:', error);
    // Never return an empty page on failure: an empty board is
    // indistinguishable from a genuinely empty venue and renders as a
    // confident "No traders yet".
    return NextResponse.json({ error: 'leaderboard_unavailable' }, { status: 500 });
  }
}
