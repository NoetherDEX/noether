import pg from 'pg';

import { wrapDriver, type Db, type Row, type SqlDriver, type SqlDriverConn } from './index.js';

export interface PgDbOptions {
  /**
   * Postgres connection string. For Supabase use the Supavisor SESSION pooler
   * (`…pooler.supabase.com:5432/postgres?sslmode=require`) — the direct
   * `db.<ref>.supabase.co` host is IPv6-only and the transaction pooler
   * (:6543) breaks session state.
   */
  connectionString: string;
  /** Pool size. Keep indexer+api sum well under the pooler's client limit. */
  max?: number;
}

const JSON_OID = 114;
const JSONB_OID = 3802;

/**
 * Per-pool type parsing:
 * - json/jsonb come back as RAW STRINGS. Every reader in api/indexer does
 *   `JSON.parse(String(row.payload_json))`; node-pg's default object parsing
 *   would silently turn that into `JSON.parse('[object Object]')`.
 * - int8/numeric keep node-pg's default string form (readers already coerce
 *   via Number()/BigInt(String()); strings avoid 2^53 truncation).
 */
function buildTypes(): pg.CustomTypesConfig {
  return {
    getTypeParser: ((oid: number, format?: string) => {
      if (oid === JSON_OID || oid === JSONB_OID) {
        return (value: string) => value;
      }
      // Delegate everything else to node-pg defaults.
      return (pg.types.getTypeParser as (oid: number, format?: string) => (value: string) => unknown)(oid, format);
    }) as pg.CustomTypesConfig['getTypeParser'],
  };
}

class PgDriver implements SqlDriver {
  private readonly pool: pg.Pool;

  constructor(opts: PgDbOptions) {
    this.pool = new pg.Pool({
      connectionString: opts.connectionString,
      max: opts.max ?? 10,
      types: buildTypes(),
    });
  }

  async query(sql: string, params: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }> {
    const res = await this.pool.query(sql, params);
    return { rows: res.rows as Row[], rowCount: res.rowCount };
  }

  async acquire(): Promise<SqlDriverConn> {
    const client = await this.pool.connect();
    let released = false;
    return {
      async query(sql: string, params: unknown[]) {
        const res = await client.query(sql, params);
        return { rows: res.rows as Row[], rowCount: res.rowCount };
      },
      release() {
        if (!released) {
          released = true;
          client.release();
        }
      },
    };
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

/** Create the production Db backed by a node-postgres pool. */
export function createPgDb(opts: PgDbOptions): Db {
  return wrapDriver(new PgDriver(opts));
}
