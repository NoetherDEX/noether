import { NextResponse } from 'next/server';
import { apiBase } from '@/lib/api/base';

export const dynamic = 'force-dynamic';

/**
 * Market-wide headline totals for the leaderboard stat tiles.
 *
 * Separate from the row proxy on purpose: `/v1/leaderboard` returns a ranked
 * page capped at 200 rows, so summing it pins TRADERS at 200 and silently
 * drops the tail's volume and trades once the market outgrows one page.
 * `/v1/leaderboard/totals` aggregates in SQL over every trader.
 */

interface GatewayTotals {
  updatedAt: number | null;
  /** 7-decimal fixed-point string. */
  volume: string;
  traders: number;
  trades: number;
}

const SCALE = 10_000_000;

export async function GET() {
  try {
    const base = apiBase();
    const res = await fetch(`${base}/v1/leaderboard/totals`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) {
      throw new Error(`gateway responded ${res.status}`);
    }
    const totals = (await res.json()) as GatewayTotals;
    if (typeof totals.traders !== 'number' || typeof totals.volume !== 'string') {
      throw new Error('gateway totals shape unexpected');
    }

    return NextResponse.json(
      {
        traders: totals.traders,
        trades: totals.trades,
        volume: Number(totals.volume) / SCALE,
        lastUpdated: totals.updatedAt ?? null,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } },
    );
  } catch (error) {
    console.error('[Leaderboard] totals proxy error:', error);
    // Never return zeroes on failure — the caller falls back to summing the
    // visible rows, which is undercounted but at least not fabricated.
    return NextResponse.json({ error: 'totals_unavailable' }, { status: 500 });
  }
}
