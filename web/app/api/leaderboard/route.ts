import { NextResponse } from 'next/server';
import { getDb, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureSchema();
    const db = getDb();

    const result = await db.execute(
      'SELECT address, trade_count, total_volume, total_pnl, liq_count, last_updated FROM traders ORDER BY total_volume DESC'
    );

    const leaderboard = result.rows.map(row => ({
      address: row.address as string,
      tradeCount: row.trade_count as number,
      totalVolume: row.total_volume as number,
      pnl: row.total_pnl as number,
      liqCount: (row.liq_count as number) ?? 0,
      // Cron-sync stamp (unix seconds) — lets the UI show "Updated Xm ago"
      // instead of presenting stale rankings as live.
      lastUpdated: (row.last_updated as number) ?? null,
    }));

    return NextResponse.json(leaderboard, {
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('[Leaderboard] DB read error:', error);
    // Never return [] on failure — an empty array is indistinguishable from a
    // genuinely empty board and renders as a confident "No traders yet".
    return NextResponse.json({ error: 'leaderboard_unavailable' }, { status: 500 });
  }
}
