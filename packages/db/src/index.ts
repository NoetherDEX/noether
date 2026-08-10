import { rewriteWithCount, SqlRewriteError } from './rewrite.js';

export { rewritePlaceholders, rewriteWithCount, SqlRewriteError } from './rewrite.js';
export { createPgDb, type PgDbOptions } from './pg.js';

/** Accepted parameter values (superset of what call sites pass today). */
export type InValue = null | undefined | string | number | bigint | boolean;

export interface InStatement {
  sql: string;
  args?: InValue[];
}

export type Row = Record<string, unknown>;

export interface ResultSet {
  rows: Row[];
  /** Rows written by INSERT/UPDATE/DELETE (pg rowCount). */
  rowsAffected: number;
}

export interface DbSession {
  execute(stmt: string | InStatement): Promise<ResultSet>;
}

export interface DbTransaction extends DbSession {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface Db extends DbSession {
  /** All statements in one transaction, results in order (libsql batch shape). */
  batch(stmts: Array<string | InStatement>, mode?: 'write' | 'read'): Promise<ResultSet[]>;
  /** Interactive transaction on a dedicated connection. */
  transaction(mode?: 'write' | 'read'): Promise<DbTransaction>;
  close(): Promise<void>;
}

/** Minimal query backend; lets tests inject PGlite instead of a pg Pool. */
export interface SqlDriverConn {
  query(sql: string, params: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
  release(): void;
}

export interface SqlDriver {
  query(sql: string, params: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
  /** Dedicated session for an interactive transaction. */
  acquire(): Promise<SqlDriverConn>;
  close(): Promise<void>;
}

/**
 * True when the error means the table doesn't exist — Postgres SQLSTATE 42P01
 * ("undefined_table"), and nothing else.
 *
 * Callers treat a `true` here as "this projection isn't populated yet" and
 * return an empty/zero result. That makes a false positive genuinely
 * dangerous: roughly twenty call sites turn it into `[]`, `0n` or `null`,
 * including the cumulative bad-debt and open-interest figures. A misreported
 * zero on those reads as "the protocol is solvent".
 *
 * This deliberately does NOT fall back to matching the message text.
 * "does not exist" is Postgres's phrasing for undefined_column (42703),
 * undefined_function/operator (42883), undefined_object (42704) and
 * invalid_catalog_name (3D000) — every one of which is a real bug that must
 * surface loudly rather than be laundered into a zero. The libsql fixtures
 * that fallback once served were retired in the Supabase migration.
 */
export function isMissingTable(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return (err as { code?: unknown }).code === '42P01';
}

function normalizeArgs(args: InValue[] | undefined): unknown[] {
  if (!args || args.length === 0) return [];
  return args.map((v) => {
    if (v === undefined) return null;
    // node-postgres does not serialize BigInt; call sites pass raw bigints
    // (candle seeder, handlers). Text form is what libsql stored anyway.
    if (typeof v === 'bigint') return v.toString();
    return v;
  });
}

function toStatement(stmt: string | InStatement): { sql: string; params: unknown[] } {
  const source = typeof stmt === 'string' ? stmt : stmt.sql;
  const params = typeof stmt === 'string' ? [] : normalizeArgs(stmt.args);
  const rewritten = rewriteWithCount(source);

  // Placeholders and arguments must agree exactly. Postgres only complains
  // when it needs MORE values than were supplied, so a query with too few
  // placeholders (the classic cause being a bare jsonb `?` operator, which the
  // scanner counts as one) would otherwise run happily against the wrong shape.
  if (rewritten.params !== params.length) {
    throw new SqlRewriteError(
      `SQL expects ${rewritten.params} placeholder(s) but ${params.length} argument(s) were supplied. ` +
        (rewritten.params > params.length
          ? 'A bare jsonb `?` operator is counted as a placeholder — use jsonb_exists() instead.'
          : 'Check for a missing ? in the statement.'),
    );
  }

  return { sql: rewritten.sql, params };
}

async function runOn(
  target: { query(sql: string, params: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }> },
  stmt: string | InStatement
): Promise<ResultSet> {
  const { sql, params } = toStatement(stmt);
  const res = await target.query(sql, params);
  return { rows: res.rows, rowsAffected: res.rowCount ?? 0 };
}

/** Wrap a raw driver in the libsql-shaped Db surface used across api + indexer. */
export function wrapDriver(driver: SqlDriver): Db {
  return {
    execute(stmt) {
      return runOn(driver, stmt);
    },

    async batch(stmts, _mode) {
      if (stmts.length === 0) return [];
      const conn = await driver.acquire();
      try {
        await conn.query('BEGIN', []);
        const results: ResultSet[] = [];
        for (const stmt of stmts) {
          results.push(await runOn(conn, stmt));
        }
        await conn.query('COMMIT', []);
        return results;
      } catch (err) {
        try {
          await conn.query('ROLLBACK', []);
        } catch {
          /* connection unusable — release below */
        }
        throw err;
      } finally {
        conn.release();
      }
    },

    async transaction(_mode) {
      const conn = await driver.acquire();
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          conn.release();
        }
      };
      try {
        await conn.query('BEGIN', []);
      } catch (err) {
        finish();
        throw err;
      }
      return {
        execute(stmt: string | InStatement) {
          return runOn(conn, stmt);
        },
        async commit() {
          if (done) return;
          try {
            await conn.query('COMMIT', []);
          } finally {
            finish();
          }
        },
        async rollback() {
          if (done) return;
          try {
            await conn.query('ROLLBACK', []);
          } catch {
            /* already aborted/closed — releasing is what matters */
          } finally {
            finish();
          }
        },
      };
    },

    close() {
      return driver.close();
    },
  };
}
