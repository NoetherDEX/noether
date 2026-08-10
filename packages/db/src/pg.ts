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
  /** Wait for a free client before failing. Unset = wait forever. */
  connectionTimeoutMillis?: number;
  /** Server-side cap on any single statement. Unset = a slow query runs forever. */
  statementTimeoutMillis?: number;
  /** Server-side cap on an idle open transaction, so a stuck tx frees its row locks. */
  idleTransactionTimeoutMillis?: number;
  /**
   * Called for pool-level errors raised outside a query (dropped idle
   * connections, pooler restarts). Wire this to the service logger.
   */
  onError?: (err: Error) => void;
  /**
   * PEM of the CA that signs the database server's certificate.
   *
   * Supply this and the connection becomes authenticated as well as
   * encrypted. Without it, the documented Supabase connection string
   * (`uselibpqcompat=true&sslmode=require`) resolves to
   * `rejectUnauthorized: false` inside pg-connection-string — measured live as
   * `tls.authorized === false` — so anyone on-path to the pooler can present
   * their own certificate and read or rewrite every query, api_keys included.
   *
   * Passed as PEM text rather than a file path so cert rotation is an env-var
   * change, not an image rebuild. Supabase's pooler chains to "Supabase Root
   * 2021 CA", which is not in any public trust store, so plain
   * `sslmode=verify-full` cannot work on its own.
   */
  caCert?: string;
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

/**
 * True when the failure killed the connection rather than just the statement.
 *
 * A SQL error (constraint violation, syntax, undefined column) carries a
 * SQLSTATE and leaves the socket perfectly usable. A network or protocol
 * failure has no SQLSTATE at all, and class 08 / 57P0x mean the server hung
 * up. Only the latter justify destroying the pooled client.
 */
function isConnectionLevel(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return true;
  const code = (err as { code?: unknown }).code;
  if (typeof code !== 'string') return true; // no SQLSTATE => transport failure
  return code.startsWith('08') || code === '57P01' || code === '57P02' || code === '57P03';
}

class PgDriver implements SqlDriver {
  private readonly pool: pg.Pool;

  constructor(opts: PgDbOptions) {
    // An explicit ssl object takes precedence over whatever the connection
    // string's sslmode resolved to, so this upgrades the link without
    // requiring the URL itself to change.
    const ca = opts.caCert?.trim();
    if (!ca) {
      console.warn(
        '[db] no CA certificate configured — the database connection is encrypted but NOT ' +
          'authenticated (set DATABASE_CA_CERT to verify the server).',
      );
    }

    this.pool = new pg.Pool({
      connectionString: opts.connectionString,
      max: opts.max ?? 10,
      types: buildTypes(),
      ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
      // Without this, a waiter queues forever: one leaked client silently
      // wedges every subsequent query with no error and no timeout.
      connectionTimeoutMillis: opts.connectionTimeoutMillis ?? 10_000,
      // Server-side ceilings. The read-side aggregates over events_raw are
      // unbounded scans, so a single pathological query must not be able to
      // pin a pooler connection indefinitely.
      statement_timeout: opts.statementTimeoutMillis ?? 30_000,
      idle_in_transaction_session_timeout: opts.idleTransactionTimeoutMillis ?? 60_000,
    });

    // MANDATORY, not optional hygiene: node-pg emits 'error' on the pool when
    // an IDLE client dies (Supavisor recycles connections routinely). An
    // EventEmitter emitting 'error' with no listener THROWS, which takes the
    // whole process down. The pool already discards the broken client, so
    // logging and continuing is the correct response.
    this.pool.on('error', (err) => {
      if (opts.onError) opts.onError(err);
      else console.error('[db] idle client error (connection discarded):', err.message);
    });
  }

  async query(sql: string, params: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }> {
    const res = await this.pool.query(sql, params);
    return { rows: res.rows as Row[], rowCount: res.rowCount };
  }

  async acquire(): Promise<SqlDriverConn> {
    const client = await this.pool.connect();
    let released = false;
    // A connection-level failure (socket reset, timeout) leaves the client in
    // an indeterminate protocol state. Releasing it clean returns it to the
    // pool for the next caller to trip over, so remember and destroy instead.
    let poisoned: Error | undefined;
    return {
      async query(sql: string, params: unknown[]) {
        try {
          const res = await client.query(sql, params);
          return { rows: res.rows as Row[], rowCount: res.rowCount };
        } catch (err) {
          if (isConnectionLevel(err)) poisoned = err as Error;
          throw err;
        }
      },
      release() {
        if (!released) {
          released = true;
          client.release(poisoned);
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
