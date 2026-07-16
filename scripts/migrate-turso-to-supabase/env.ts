import { createClient, type Client } from '@libsql/client';
import pg from 'pg';

/** Fail fast with a readable message instead of a driver stack trace. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env: ${name} (see README.md in this folder)`);
    process.exit(1);
  }
  return v;
}

/** Old indexer/API projection DB (Railway's LIBSQL_URL pair). */
export function openIndexerTurso(): Client {
  return createClient({
    url: requireEnv('TURSO_LIBSQL_URL'),
    authToken: process.env.TURSO_LIBSQL_AUTH_TOKEN || undefined,
  });
}

/** Old web leaderboard DB (Vercel's TURSO_DATABASE_URL pair). */
export function openWebTurso(): Client {
  return createClient({
    url: requireEnv('TURSO_WEB_DATABASE_URL'),
    authToken: process.env.TURSO_WEB_AUTH_TOKEN || undefined,
  });
}

/** Target Supabase Postgres (session-pooler URL, sslmode=require). */
export function openSupabase(): pg.Pool {
  return new pg.Pool({ connectionString: requireEnv('DATABASE_URL'), max: 4 });
}

export async function sourceTableExists(db: Client, table: string): Promise<boolean> {
  const res = await db.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [table],
  });
  return res.rows.length > 0;
}

export async function sourceColumns(db: Client, table: string): Promise<Set<string>> {
  const res = await db.execute(`PRAGMA table_info(${table})`);
  return new Set(res.rows.map((r) => String((r as { name?: unknown }).name)));
}
