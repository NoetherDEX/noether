import { createPgDb, type Db } from '@noether/db';
import type { IndexerConfig } from './config.js';

export function createDb(config: IndexerConfig): Db {
  // Small pool: the poll loop is sequential; sync loops + health checks
  // account for the rest. Keep indexer+api totals under the Supavisor
  // session-pool client limit.
  return createPgDb({ connectionString: config.databaseUrl, max: 5 });
}
