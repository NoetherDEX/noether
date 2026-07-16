/**
 * SQL migration runner for the indexer.
 *
 * Each migration is a numbered SQL file under ./migrations.
 * Filenames must match: NNN_short_description.sql
 * Migrations are applied in lexical order; each is recorded in
 * `schema_versions` so subsequent runs are idempotent.
 *
 * Statements inside a file are separated by `--# split` markers and run
 * one at a time (extended-protocol queries cannot batch statements), but
 * each migration file + its schema_versions record commit as ONE
 * transaction — Postgres DDL is transactional, so a half-applied
 * migration rolls back instead of stranding the schema.
 *
 * Usage:
 *   npm run migrate          # apply pending migrations
 *   tsx src/migrations.ts    # same, direct invocation
 */

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Db } from '@noether/db';
import { loadConfig } from './config.js';
import { createDb } from './db.js';

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

interface Migration {
  id: number;
  name: string;
  filename: string;
  sql: string;
}

async function ensureSchemaVersionsTable(db: Db): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      id          BIGINT PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  BIGINT NOT NULL
    );
  `);
}

async function loadMigrations(): Promise<Migration[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  const sqlFiles = entries.filter((f) => f.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  for (const filename of sqlFiles) {
    const match = filename.match(/^(\d+)_(.+)\.sql$/);
    if (!match) {
      throw new Error(
        `Invalid migration filename: ${filename}. Expected format: NNN_description.sql`,
      );
    }
    const id = Number(match[1]);
    const name = match[2]!;
    const sql = await readFile(resolve(MIGRATIONS_DIR, filename), 'utf8');
    migrations.push({ id, name, filename, sql });
  }
  return migrations;
}

async function appliedIds(db: Db): Promise<Set<number>> {
  const result = await db.execute('SELECT id FROM schema_versions');
  const ids = new Set<number>();
  for (const row of result.rows) {
    ids.add(Number(row.id));
  }
  return ids;
}

export async function runMigrations(db: Db): Promise<{ applied: Migration[] }> {
  await ensureSchemaVersionsTable(db);
  const migrations = await loadMigrations();
  const already = await appliedIds(db);

  const applied: Migration[] = [];
  for (const m of migrations) {
    if (already.has(m.id)) continue;

    const statements = m.sql
      .split(/^--#\s*split\s*$/gim)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const tx = await db.transaction('write');
    try {
      for (const stmt of statements) {
        await tx.execute(stmt);
      }
      await tx.execute({
        sql: 'INSERT INTO schema_versions (id, name, applied_at) VALUES (?, ?, ?)',
        args: [m.id, m.name, Date.now()],
      });
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
    applied.push(m);
  }

  return { applied };
}

// CLI entry: `tsx src/migrations.ts`
const isDirect = import.meta.url === `file://${process.argv[1]}`;
if (isDirect) {
  const config = loadConfig();
  const db = createDb(config);
  try {
    const { applied } = await runMigrations(db);
    if (applied.length === 0) {
      console.log('No pending migrations.');
    } else {
      for (const m of applied) {
        console.log(`Applied ${m.filename}`);
      }
    }
  } finally {
    await db.close();
  }
}
