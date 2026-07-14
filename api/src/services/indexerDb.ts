import { createPgDb, type Db } from '@noether/db';
import type { ApiConfig } from '../config.js';

/**
 * Open a Postgres pool pointing at the indexer's database (Supabase).
 * The API mostly reads — the indexer is the projection writer; the API
 * itself writes only api_keys and rate_limit_buckets.
 */
export function createIndexerDb(config: ApiConfig): Db {
  return createPgDb({ connectionString: config.databaseUrl, max: 10 });
}
