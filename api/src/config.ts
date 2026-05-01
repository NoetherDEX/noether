import 'dotenv/config';
import type { Network } from '@noether/types';
import { loadContracts, type ContractsManifest } from '@noether/shared';

export interface ApiConfig {
  network: Network;
  host: string;
  port: number;
  logLevel: string;
  corsOrigin: string;
  rpcUrl: string;
  /** Public key whose account will be used as source for read-only simulations. */
  sourceAccount: string;
  /** libsql URL for the indexer database (read-only consumer). */
  libsqlUrl: string;
  libsqlAuthToken: string | undefined;
  contracts: ContractsManifest;
}

export function loadConfig(): ApiConfig {
  const contracts = loadContracts();
  return {
    network: (process.env.NETWORK ?? 'testnet') as Network,
    host: process.env.API_HOST ?? '0.0.0.0',
    port: Number(process.env.API_PORT ?? 4000),
    logLevel: process.env.API_LOG_LEVEL ?? 'info',
    corsOrigin: process.env.API_CORS_ORIGIN ?? '*',
    rpcUrl: process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    sourceAccount: process.env.API_SOURCE_ACCOUNT ?? contracts.admin,
    libsqlUrl: process.env.LIBSQL_URL ?? 'file:../indexer/data/indexer.db',
    libsqlAuthToken: process.env.LIBSQL_AUTH_TOKEN || undefined,
    contracts,
  };
}
