/**
 * Parity report: old Turso indexer DB vs new Supabase DB.
 *
 * Prints per-table row counts, events_raw per-topic counts + max ledger,
 * value-sum spot checks, poll_cursor equality, and an EXACT key_id set
 * check for api_keys (the one non-re-derivable table). Exits 1 on any
 * mismatch — treat that as a cutover gate.
 *
 * Run AFTER copy.ts, while the old indexer is stopped (a moving source
 * shows false drift). Supabase counts may legitimately EXCEED Turso counts
 * once the new indexer has started backfilling — run parity before that.
 */

import { createHash } from 'node:crypto';
import { openIndexerTurso, openSupabase, sourceTableExists } from './env.js';
import { TABLES } from './tables.js';

let failures = 0;

function check(label: string, oldVal: string | number, newVal: string | number, exact = true): void {
  const ok = String(oldVal) === String(newVal);
  if (ok) {
    console.log(`  PASS  ${label}: ${newVal}`);
  } else if (!exact) {
    console.log(`  NOTE  ${label}: turso=${oldVal} supabase=${newVal}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}: turso=${oldVal} supabase=${newVal}`);
  }
}

async function main(): Promise<void> {
  const src = openIndexerTurso();
  const dst = openSupabase();
  try {
    console.log('— Row counts —');
    for (const spec of TABLES) {
      const oldN = (await sourceTableExists(src, spec.name))
        ? Number((await src.execute(`SELECT COUNT(*) AS n FROM ${spec.name}`)).rows[0]?.n ?? 0)
        : 0;
      const newN = Number((await dst.query(`SELECT COUNT(*) AS n FROM ${spec.name}`)).rows[0].n);
      check(`${spec.name} count`, oldN, newN);
    }

    console.log('— events_raw detail —');
    if (await sourceTableExists(src, 'events_raw')) {
      const oldTopics = await src.execute('SELECT topic, COUNT(*) AS n FROM events_raw GROUP BY topic ORDER BY topic');
      const newTopics = await dst.query('SELECT topic, COUNT(*) AS n FROM events_raw GROUP BY topic ORDER BY topic');
      const fmt = (rows: unknown[]) =>
        rows.map((r) => `${(r as { topic: string }).topic}=${(r as { n: unknown }).n}`).join(' ');
      check('events_raw per-topic', fmt(oldTopics.rows as unknown[]), fmt(newTopics.rows as unknown[]));
      const oldMax = Number((await src.execute('SELECT MAX(ledger) AS m FROM events_raw')).rows[0]?.m ?? 0);
      const newMax = Number((await dst.query('SELECT MAX(ledger) AS m FROM events_raw')).rows[0].m ?? 0);
      check('events_raw max ledger', oldMax, newMax);
    }

    console.log('— Value sums —');
    if (await sourceTableExists(src, 'trades')) {
      const o = (await src.execute(
        'SELECT COALESCE(SUM(CAST(size AS INTEGER)),0) AS s, COALESCE(SUM(CAST(pnl AS INTEGER)),0) AS p FROM trades',
      )).rows[0] as { s?: unknown; p?: unknown };
      const n = (await dst.query(
        "SELECT COALESCE(SUM(size::numeric),0)::text AS s, COALESCE(SUM(pnl::numeric),0)::text AS p FROM trades",
      )).rows[0] as { s: string; p: string };
      check('trades SUM(size)', String(o.s ?? 0), n.s);
      check('trades SUM(pnl)', String(o.p ?? 0), n.p);
    }
    if (await sourceTableExists(src, 'vaults')) {
      const o = (await src.execute('SELECT COALESCE(SUM(CAST(total_usdc AS INTEGER)),0) AS s FROM vaults')).rows[0] as { s?: unknown };
      const n = (await dst.query('SELECT COALESCE(SUM(total_usdc),0)::text AS s FROM vaults')).rows[0] as { s: string };
      check('vaults SUM(total_usdc)', String(o.s ?? 0), n.s);
    }
    if (await sourceTableExists(src, 'referral_trades')) {
      const o = (await src.execute('SELECT COALESCE(SUM(CAST(payout AS INTEGER)),0) AS s FROM referral_trades')).rows[0] as { s?: unknown };
      const n = (await dst.query('SELECT COALESCE(SUM(payout::numeric),0)::text AS s FROM referral_trades')).rows[0] as { s: string };
      check('referral_trades SUM(payout)', String(o.s ?? 0), n.s);
    }

    console.log('— poll_cursor —');
    if (await sourceTableExists(src, 'poll_cursor')) {
      const o = (await src.execute('SELECT last_ledger FROM poll_cursor WHERE id = 1')).rows[0] as { last_ledger?: unknown } | undefined;
      const n = (await dst.query('SELECT last_ledger FROM poll_cursor WHERE id = 1')).rows[0] as { last_ledger?: unknown } | undefined;
      // NOTE not FAIL: the runbook rewinds the Supabase cursor on purpose.
      check('poll_cursor last_ledger', String(o?.last_ledger ?? '-'), String(n?.last_ledger ?? '-'), false);
    }

    console.log('— api_keys exact set —');
    if (await sourceTableExists(src, 'api_keys')) {
      const oldIds = (await src.execute('SELECT key_id FROM api_keys ORDER BY key_id')).rows.map((r) =>
        String((r as unknown as { key_id: unknown }).key_id),
      );
      const newIds = (await dst.query('SELECT key_id FROM api_keys ORDER BY key_id')).rows.map((r) =>
        String((r as { key_id: unknown }).key_id),
      );
      const digest = (ids: string[]) => createHash('sha256').update(ids.join('\n')).digest('hex').slice(0, 16);
      check('api_keys count', oldIds.length, newIds.length);
      check('api_keys key_id checksum', digest(oldIds), digest(newIds));
    }

    console.log(failures === 0 ? '\nPARITY OK' : `\nPARITY FAILED: ${failures} mismatch(es)`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    await dst.end();
    src.close();
  }
}

main().catch((err) => {
  console.error('parity failed to run:', err);
  process.exit(1);
});
