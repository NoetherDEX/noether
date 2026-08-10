import { createPgDb, type Db } from '@noether/db';
import type { IndexerConfig } from './config.js';

export function createDb(config: IndexerConfig): Db {
  // Small pool: the poll loop is sequential; sync loops + health checks
  // account for the rest. Keep indexer+api totals under the Supavisor
  // session-pool client limit.
  return createPgDb({
    connectionString: config.databaseUrl,
    max: 5,
    // Unhandled pool 'error' events throw and kill the poll loop; a dropped
    // idle connection must not cost us the cursor.
    onError: (err) => console.error('[indexer][db] idle client error:', err.message),
    // The indexer writes in batches that are larger than any API read.
    statementTimeoutMillis: 60_000,
    caCert: process.env.DATABASE_CA_CERT,
  });
}
