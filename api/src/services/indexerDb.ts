import { createPgDb, type Db } from '@noether/db';
import type { ApiConfig } from '../config.js';

/**
 * Open a Postgres pool pointing at the indexer's database (Supabase).
 * The API mostly reads — the indexer is the projection writer; the API
 * itself writes only api_keys and rate_limit_buckets.
 */
export function createIndexerDb(config: ApiConfig): Db {
  return createPgDb({
    connectionString: config.databaseUrl,
    max: 10,
    // Pool-level errors arrive outside any query (Supavisor recycling an idle
    // connection). Unhandled, the EventEmitter throws and kills the gateway.
    onError: (err) => console.error('[api][db] idle client error:', err.message),
    // PEM for the pooler's CA. Without it the link is encrypted but
    // unauthenticated, which is how it shipped.
    caCert: process.env.DATABASE_CA_CERT,
  });
}
