import 'dotenv/config';
import type { Network } from '@noether/types';
import { getRpcUrls, loadContracts, type ContractsManifest } from '@noether/shared';

export interface IndexerConfig {
  network: Network;
  rpcUrls: string[];
  rpcUrl: string;
  libsqlUrl: string;
  libsqlAuthToken: string | undefined;
  pollIntervalMs: number;
  coldStartLedgers: number;
  healthPort: number;
  retentionWarnLedgers: number;
  contracts: ContractsManifest;
  logLevel: string;
}

export function loadConfig(): IndexerConfig {
  const network = (process.env.NETWORK ?? 'testnet') as Network;
  const contracts = loadContracts();
  const rpcUrls = getRpcUrls(network);

  return {
    network,
    rpcUrls,
    rpcUrl: rpcUrls[0]!,
    libsqlUrl: process.env.LIBSQL_URL ?? 'file:./data/indexer.db',
    libsqlAuthToken: process.env.LIBSQL_AUTH_TOKEN || undefined,
    pollIntervalMs: Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 2000),
    coldStartLedgers: Number(process.env.INDEXER_COLD_START_LEDGERS ?? 20000),
    healthPort: Number(process.env.INDEXER_HEALTH_PORT ?? 8080),
    retentionWarnLedgers: Number(process.env.INDEXER_RETENTION_WARN_LEDGERS ?? 10000),
    contracts,
    logLevel: process.env.INDEXER_LOG_LEVEL ?? 'info',
  };
}
