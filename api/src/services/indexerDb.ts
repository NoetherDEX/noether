import { createClient, type Client } from '@libsql/client';
import type { ApiConfig } from '../config.js';

/**
 * Open a libsql client pointing at the indexer's database.
 * The API only reads — the indexer is the writer. We share the same DB
 * so projections can be added later without an extra read replica.
 */
export function createIndexerDb(config: ApiConfig): Client {
  return createClient({
    url: config.libsqlUrl,
    authToken: config.libsqlAuthToken,
  });
}
