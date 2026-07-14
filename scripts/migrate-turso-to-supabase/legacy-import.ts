/**
 * Import the retired web leaderboard (Vercel-cron Turso DB) into
 * `leaderboard_legacy` as the pre-cutover baseline.
 *
 * Recomputes per-wallet aggregates from the legacy `trades` rows using the
 * cron's own formulas (trade_count = opens, volume = open-side notional,
 * pnl = non-open pnl, liq_count = liquidation events), restricted to rows
 * inserted BEFORE the 2026-07-06T17:00Z prod cutover — everything after
 * that is re-derived exactly from chain by the indexer backfill, so
 * importing it would double count.
 *
 * Legacy values are USD floats (REAL); they are scaled to Noether's
 * 7-decimal integer units here so the gateway can merge them with live
 * stats without unit juggling.
 *
 * Idempotent: rerun replaces each wallet's row.
 *
 *   TURSO_WEB_DATABASE_URL=… TURSO_WEB_AUTH_TOKEN=… DATABASE_URL=… npm run legacy
 *   npm run legacy -- --cutover=1783357200      # override the boundary
 */

import { openSupabase, openWebTurso, sourceTableExists } from './env.js';

/** 2026-07-06T17:00:00Z — the prod 14-pair stack cutover. */
const DEFAULT_CUTOVER_TS = 1_783_357_200;
const SCALE = 10_000_000;

function to7dp(usd: number): string {
  return BigInt(Math.round(usd * SCALE)).toString();
}

async function main(): Promise<void> {
  const cutoverArg = process.argv.find((a) => a.startsWith('--cutover='))?.slice('--cutover='.length);
  const cutoverTs = cutoverArg ? Number(cutoverArg) : DEFAULT_CUTOVER_TS;
  if (!Number.isFinite(cutoverTs) || cutoverTs <= 0) {
    console.error(`Bad --cutover value: ${cutoverArg}`);
    process.exit(1);
  }

  const src = openWebTurso();
  const dst = openSupabase();
  try {
    if (!(await sourceTableExists(src, 'trades'))) {
      console.error('Legacy web DB has no `trades` table — wrong TURSO_WEB_DATABASE_URL?');
      process.exit(1);
    }

    // NOTE: `timestamp` is the cron's INSERT time, not the trade time — the
    // legacy pipeline never stored tx timestamps. Rows scanned into the DB
    // after the cutover belong to the new market and are excluded (they are
    // re-derived from chain). Documented approximation.
    const agg = await src.execute({
      sql: `
        SELECT
          trader,
          SUM(CASE WHEN event_type = 'position_opened' THEN 1 ELSE 0 END) AS trade_count,
          SUM(CASE WHEN event_type = 'position_opened' THEN size ELSE 0 END) AS total_volume,
          SUM(CASE WHEN event_type != 'position_opened' THEN pnl ELSE 0 END) AS total_pnl,
          SUM(CASE WHEN event_type IN ('position_liquidated', 'cross_liq') THEN 1 ELSE 0 END) AS liq_count
        FROM trades
        WHERE timestamp < ?
        GROUP BY trader
      `,
      args: [cutoverTs],
    });

    const excluded = await src.execute({
      sql: 'SELECT COUNT(*) AS n FROM trades WHERE timestamp >= ?',
      args: [cutoverTs],
    });

    let imported = 0;
    const importedAt = Date.now();
    for (const r of agg.rows) {
      const row = r as Record<string, unknown>;
      const address = String(row.trader ?? '');
      if (!address) continue;
      await dst.query(
        `INSERT INTO leaderboard_legacy (address, trade_count, total_volume, total_pnl, liq_count, source, imported_at)
         VALUES ($1, $2, $3, $4, $5, 'web-turso-2026-07', $6)
         ON CONFLICT (address) DO UPDATE SET
           trade_count = EXCLUDED.trade_count,
           total_volume = EXCLUDED.total_volume,
           total_pnl = EXCLUDED.total_pnl,
           liq_count = EXCLUDED.liq_count,
           source = EXCLUDED.source,
           imported_at = EXCLUDED.imported_at`,
        [
          address,
          Number(row.trade_count ?? 0),
          to7dp(Number(row.total_volume ?? 0)),
          to7dp(Number(row.total_pnl ?? 0)),
          Number(row.liq_count ?? 0),
          importedAt,
        ],
      );
      imported += 1;
    }

    const check = await dst.query(
      'SELECT COUNT(*) AS n, SUM(total_volume) AS vol, SUM(trade_count) AS trades FROM leaderboard_legacy',
    );
    const c = check.rows[0] as { n: string; vol: string | null; trades: string | null };
    console.log(
      `Imported ${imported} wallets (cutover < ${cutoverTs}; ${Number((excluded.rows[0] as { n?: unknown })?.n ?? 0)} post-cutover trade rows excluded).`,
    );
    console.log(
      `leaderboard_legacy now: ${c.n} wallets, ${c.trades ?? 0} trades, $${(Number(c.vol ?? 0) / SCALE).toLocaleString('en-US', { maximumFractionDigits: 0 })} volume.`,
    );
  } finally {
    await dst.end();
    src.close();
  }
}

main().catch((err) => {
  console.error('legacy import failed:', err);
  process.exit(1);
});
