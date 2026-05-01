import 'dotenv/config';
import type { Network } from '@noether/types';
import { loadContracts, type ContractsManifest } from '@noether/shared';

export interface IndexerConfig {
  network: Network;
  rpcUrl: string;
  libsqlUrl: string;
  libsqlAuthToken: string | undefined;
  pollIntervalMs: number;
  coldStartLedgers: number;
  contracts: ContractsManifest;
  logLevel: string;
}

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function loadConfig(): IndexerConfig {
  const network = (process.env.NETWORK ?? 'testnet') as Network;
  const contracts = loadContracts();

  return {
    network,
    rpcUrl: required('SOROBAN_RPC_URL', 'https://soroban-testnet.stellar.org'),
    libsqlUrl: required('LIBSQL_URL', 'file:./data/indexer.db'),
    libsqlAuthToken: process.env.LIBSQL_AUTH_TOKEN || undefined,
    pollIntervalMs: Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 2000),
    coldStartLedgers: Number(process.env.INDEXER_COLD_START_LEDGERS ?? 20000),
    contracts,
    logLevel: process.env.INDEXER_LOG_LEVEL ?? 'info',
  };
}
