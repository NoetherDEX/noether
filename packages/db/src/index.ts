import { rewritePlaceholders } from './rewrite.js';

export { rewritePlaceholders } from './rewrite.js';
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
 * True when the error means the table doesn't exist. Postgres code 42P01
 * ("undefined_table"); the message check keeps pre-migration libsql fixtures
 * and wrapped errors working.
 */
export function isMissingTable(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === '42P01') return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && (message.includes('no such table') || message.includes('does not exist'));
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
  if (typeof stmt === 'string') {
    return { sql: rewritePlaceholders(stmt), params: [] };
  }
  return { sql: rewritePlaceholders(stmt.sql), params: normalizeArgs(stmt.args) };
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
