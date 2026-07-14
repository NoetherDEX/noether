/**
 * Copy all indexer/API tables from the old Turso DB into Supabase.
 *
 * Idempotent and resumable: every insert is `ON CONFLICT DO NOTHING`
 * (targetless — any unique violation is skipped), so reruns and partial
 * runs are safe. Run the baseline migration first:
 *
 *   DATABASE_URL=… npm -w @noether/indexer run migrate
 *
 * Then:
 *   TURSO_LIBSQL_URL=… TURSO_LIBSQL_AUTH_TOKEN=… DATABASE_URL=… npm run copy
 *   npm run copy -- --table=events_raw     # redo a single table
 */

import type { Client } from '@libsql/client';
import type pg from 'pg';
import { openIndexerTurso, openSupabase, sourceColumns, sourceTableExists } from './env.js';
import { TABLES, type TableSpec } from './tables.js';

const READ_PAGE = 2_000;
const WRITE_CHUNK = 500;

type Cell = string | number | bigint | null;

function normalize(v: unknown): Cell {
  if (v === undefined || v === null) return null;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return Buffer.from(v).toString('utf8');
  return v as Cell;
}

async function copyTable(src: Client, dst: pg.Pool, spec: TableSpec): Promise<number> {
  if (!(await sourceTableExists(src, spec.name))) {
    console.log(`  ${spec.name}: absent in source (old schema) — skipped`);
    return 0;
  }
  const present = await sourceColumns(src, spec.name);
  const cols = spec.columns.filter((c) => present.has(c));
  const missing = spec.columns.filter((c) => !present.has(c));
  if (missing.length > 0) {
    console.log(`  ${spec.name}: source lacks [${missing.join(', ')}] — inserting NULL for those`);
  }

  const keyCols = spec.key;
  for (const k of keyCols) {
    if (!present.has(k)) {
      console.log(`  ${spec.name}: source lacks key column ${k} — skipped (nothing to page on)`);
      return 0;
    }
  }

  const colList = cols.join(', ');
  const orderBy = keyCols.join(', ');
  let lastKey: Cell[] | null = null;
  let copied = 0;

  for (;;) {
    let sql = `SELECT ${colList} FROM ${spec.name}`;
    const args: Cell[] = [];
    if (lastKey) {
      // Row-value keyset pagination (SQLite ≥3.15 supports tuples).
      const tuple = keyCols.map(() => '?').join(', ');
      sql += ` WHERE (${orderBy}) > (${tuple})`;
      args.push(...lastKey);
    }
    sql += ` ORDER BY ${orderBy} LIMIT ${READ_PAGE}`;

    const page = await src.execute({ sql, args: args as never[] });
    if (page.rows.length === 0) break;

    const rows = page.rows.map((r) => cols.map((c) => normalize((r as Record<string, unknown>)[c])));
    for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
      const chunk = rows.slice(i, i + WRITE_CHUNK);
      const width = cols.length;
      const valuesSql = chunk
        .map((_, ri) => `(${cols.map((_c, ci) => `$${ri * width + ci + 1}`).join(', ')})`)
        .join(', ');
      const insertSql = `INSERT INTO ${spec.name} (${colList}) VALUES ${valuesSql} ON CONFLICT DO NOTHING`;
      await dst.query(insertSql, chunk.flat());
    }

    copied += page.rows.length;
    const lastRow = page.rows[page.rows.length - 1] as Record<string, unknown>;
    lastKey = keyCols.map((k) => normalize(lastRow[k]));
    process.stdout.write(`\r  ${spec.name}: ${copied} rows…`);
    if (page.rows.length < READ_PAGE) break;
  }

  if (copied > 0) process.stdout.write('\n');
  else console.log(`  ${spec.name}: 0 rows`);

  if (spec.identity) {
    await dst.query(
      `SELECT setval(pg_get_serial_sequence('${spec.name}', 'id'), (SELECT COALESCE(MAX(id), 0) + 1 FROM ${spec.name}), false)`,
    );
  }
  return copied;
}

async function copyPollCursor(src: Client, dst: pg.Pool): Promise<void> {
  if (!(await sourceTableExists(src, 'poll_cursor'))) {
    console.log('  poll_cursor: absent in source — skipped');
    return;
  }
  const res = await src.execute('SELECT id, last_ledger, last_pagination_token, updated_at FROM poll_cursor WHERE id = 1');
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    console.log('  poll_cursor: no row');
    return;
  }
  await dst.query(
    `INSERT INTO poll_cursor (id, last_ledger, last_pagination_token, updated_at)
     VALUES (1, $1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       last_ledger = EXCLUDED.last_ledger,
       last_pagination_token = EXCLUDED.last_pagination_token,
       updated_at = EXCLUDED.updated_at`,
    [normalize(row.last_ledger), normalize(row.last_pagination_token), normalize(row.updated_at)],
  );
  console.log(`  poll_cursor: last_ledger=${row.last_ledger} copied (rewind it before starting the indexer — see rewind-cursor.ts)`);
}

async function main(): Promise<void> {
  const only = process.argv.find((a) => a.startsWith('--table='))?.slice('--table='.length);
  const src = openIndexerTurso();
  const dst = openSupabase();
  const started = Date.now();
  console.log(`Copying ${only ?? 'all tables'} → Supabase`);

  try {
    let total = 0;
    for (const spec of TABLES) {
      if (only && spec.name !== only) continue;
      total += await copyTable(src, dst, spec);
    }
    if (!only || only === 'poll_cursor') {
      await copyPollCursor(src, dst);
    }
    console.log(`Done: ${total} rows in ${((Date.now() - started) / 1000).toFixed(1)}s. Now run: npm run parity`);
  } finally {
    await dst.end();
    src.close();
  }
}

main().catch((err) => {
  console.error('copy failed:', err);
  process.exit(1);
});
