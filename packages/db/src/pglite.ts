import type { PGlite } from '@electric-sql/pglite';

import { wrapDriver, type Db, type Row, type SqlDriver, type SqlDriverConn } from './index.js';

/**
 * PGlite cells arrive through PGlite's own type parsing, which turns
 * json/jsonb into objects. Production (node-pg driver) returns them as raw
 * strings, so re-stringify object cells to keep the two backends identical.
 * Safe because the schema has no other object-producing column types (all
 * timestamps are BIGINT epochs, no bytea/arrays).
 */
function normalizeRow(row: Row): Row {
  let out: Row | null = null;
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (value !== null && typeof value === 'object' && !(value instanceof Uint8Array)) {
      if (out === null) out = { ...row };
      out[key] = JSON.stringify(value);
    } else if (typeof value === 'bigint') {
      // Mirror node-pg's int8-as-string default.
      if (out === null) out = { ...row };
      out[key] = value.toString();
    }
  }
  return out ?? row;
}

interface PgliteResult {
  rows: Row[];
  affectedRows?: number;
}

class PgliteDriver implements SqlDriver {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly pglite: PGlite) {}

  /** PGlite is a single session — serialize all access through one lane. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async rawQuery(sql: string, params: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }> {
    const res = (await this.pglite.query(sql, params as never[])) as unknown as PgliteResult;
    return { rows: res.rows.map(normalizeRow), rowCount: res.affectedRows ?? res.rows.length };
  }

  query(sql: string, params: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }> {
    return this.run(() => this.rawQuery(sql, params));
  }

  async acquire(): Promise<SqlDriverConn> {
    // Hold the lane until release() so BEGIN…COMMIT stays exclusive.
    let unlock!: () => void;
    const held = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      void this.run(() => {
        resolve();
        return held;
      });
    });
    await ready;

    const self = this;
    let released = false;
    return {
      query(sql: string, params: unknown[]) {
        return self.rawQuery(sql, params);
      },
      release() {
        if (!released) {
          released = true;
          unlock();
        }
      },
    };
  }

  close(): Promise<void> {
    return this.run(() => this.pglite.close());
  }
}

/** Wrap an existing PGlite instance (tests, local tools) in the Db surface. */
export function createPgliteDb(pglite: PGlite): Db {
  return wrapDriver(new PgliteDriver(pglite));
}
