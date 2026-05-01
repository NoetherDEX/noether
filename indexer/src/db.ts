import { createClient, type Client } from '@libsql/client';
import type { IndexerConfig } from './config.js';

export function createDb(config: IndexerConfig): Client {
  return createClient({
    url: config.libsqlUrl,
    authToken: config.libsqlAuthToken,
  });
}
