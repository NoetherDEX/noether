import { NextResponse } from 'next/server';
import { getDb, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureSchema();
    const db = getDb();

    const result = await db.execute(
      'SELECT address, trade_count, total_volume, total_pnl FROM traders ORDER BY total_volume DESC'
    );

    const leaderboard = result.rows.map(row => ({
      address: row.address as string,
      tradeCount: row.trade_count as number,
      totalVolume: row.total_volume as number,
      pnl: row.total_pnl as number,
    }));

    return NextResponse.json(leaderboard, {
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('[Leaderboard] DB read error:', error);
    return NextResponse.json([], { status: 500 });
  }
}
