/**
 * Rewind the Supabase poll_cursor so the indexer's own poll loop
 * re-ingests the current-market era through the production decoders.
 *
 * The copied cursor is frozen at 2026-06-08 (ledger 2,971,053) — 35 days
 * stale. Rather than resume there (RPC retention is long gone), set it to
 * just before the 2026-07-06T17:00Z prod stack cutover ledger and let the
 * poller walk forward. If RPC retention no longer reaches that ledger the
 * poller records a `ledger_gaps` row and clamps — check that table after
 * the first poll and decide on a Horizon top-up if it's non-empty.
 *
 *   DATABASE_URL=… npm run rewind-cursor -- --ledger=<ledger>
 *
 * Find the cutover ledger via stellar.expert (block explorer, search by
 * time 2026-07-06 17:00 UTC) or Horizon /ledgers pagination.
 */

import { openSupabase } from './env.js';

async function main(): Promise<void> {
  const arg = process.argv.find((a) => a.startsWith('--ledger='))?.slice('--ledger='.length);
  const ledger = Number(arg);
  if (!arg || !Number.isInteger(ledger) || ledger <= 0) {
    console.error('Usage: npm run rewind-cursor -- --ledger=<ledger sequence>');
    process.exit(1);
  }

  const dst = openSupabase();
  try {
    const before = await dst.query('SELECT last_ledger FROM poll_cursor WHERE id = 1');
    const prev = before.rows[0]?.last_ledger ?? '(none)';
    await dst.query(
      `INSERT INTO poll_cursor (id, last_ledger, last_pagination_token, updated_at)
       VALUES (1, $1, NULL, $2)
       ON CONFLICT (id) DO UPDATE SET
         last_ledger = EXCLUDED.last_ledger,
         last_pagination_token = NULL,
         updated_at = EXCLUDED.updated_at`,
      [ledger - 1, Date.now()],
    );
    console.log(`poll_cursor: ${prev} → ${ledger - 1} (poller starts at ledger ${ledger}).`);
    console.log('Start the indexer and watch /healthz cursorLagSeconds shrink; then check ledger_gaps.');
  } finally {
    await dst.end();
  }
}

main().catch((err) => {
  console.error('rewind failed:', err);
  process.exit(1);
});
