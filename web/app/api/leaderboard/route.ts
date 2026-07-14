import { NextResponse } from 'next/server';
import { apiBase } from '@/lib/api/base';

export const dynamic = 'force-dynamic';

/**
 * Thin server-side proxy to the gateway's durable leaderboard
 * (indexer → Postgres → /v1/leaderboard), mapped to the exact
 * LeaderboardTrader array shape the page has always consumed.
 *
 * Replaces the per-minute Horizon-BFS cron + separate Turso DB (retired
 * 2026-07): the gateway board is scoped to the live market deployment and
 * already merged with the pre-2026-07-06 legacy baseline.
 */

interface GatewayLeader {
  trader: string;
  /** 7-decimal fixed-point strings. */
  pnl: string;
  volume: string;
  trades: number;
  liqCount: number;
}

interface GatewayBoard {
  sort: string;
  updatedAt: number | null;
  leaders: GatewayLeader[];
}

const SCALE = 10_000_000;

export async function GET() {
  try {
    const base = apiBase();
    const res = await fetch(`${base}/v1/leaderboard?sort=volume&limit=200`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) {
      throw new Error(`gateway responded ${res.status}`);
    }
    const board = (await res.json()) as GatewayBoard;
    if (!Array.isArray(board.leaders)) {
      throw new Error('gateway leaderboard shape unexpected');
    }

    const leaderboard = board.leaders.map((l) => ({
      address: l.trader,
      tradeCount: l.trades,
      totalVolume: Number(l.volume) / SCALE,
      pnl: Number(l.pnl) / SCALE,
      liqCount: l.liqCount ?? 0,
      // Index freshness stamp (unix seconds) — lets the UI show
      // "Updated Xm ago" instead of presenting stale rankings as live.
      lastUpdated: board.updatedAt ?? null,
    }));

    return NextResponse.json(leaderboard, {
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('[Leaderboard] gateway proxy error:', error);
    // Never return [] on failure — an empty array is indistinguishable from a
    // genuinely empty board and renders as a confident "No traders yet".
    return NextResponse.json({ error: 'leaderboard_unavailable' }, { status: 500 });
  }
}
