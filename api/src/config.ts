import 'dotenv/config';
import type { Network } from '@noether/types';
import { getRpcUrls, loadContracts, type ContractsManifest } from '@noether/shared';

export interface ApiConfig {
  network: Network;
  host: string;
  port: number;
  logLevel: string;
  corsOrigin: string;
  rpcUrls: string[];
  rpcUrl: string;
  /** Public key whose account will be used as source for read-only simulations. */
  sourceAccount: string;
  /** libsql URL for the indexer database (read-only consumer). */
  libsqlUrl: string;
  libsqlAuthToken: string | undefined;
  contracts: ContractsManifest;
}

export const DEFAULT_HMAC_PEPPER = 'change-me-in-production';

export function loadConfig(): ApiConfig {
  const contracts = loadContracts();
  const network = (process.env.NETWORK ?? 'testnet') as Network;
  const rpcUrls = getRpcUrls(network);
  const corsOrigin = process.env.API_CORS_ORIGIN ?? '*';
  if (process.env.NODE_ENV === 'production') {
    assertProductionEnv(corsOrigin);
  }
  return {
    network,
    host: process.env.API_HOST ?? '0.0.0.0',
    port: Number(process.env.API_PORT ?? 4000),
    logLevel: process.env.API_LOG_LEVEL ?? 'info',
    corsOrigin,
    rpcUrls,
    rpcUrl: rpcUrls[0]!,
    sourceAccount: process.env.API_SOURCE_ACCOUNT ?? contracts.admin,
    libsqlUrl: process.env.LIBSQL_URL ?? 'file:../indexer/data/indexer.db',
    libsqlAuthToken: process.env.LIBSQL_AUTH_TOKEN || undefined,
    contracts,
  };
}

/**
 * Fail-closed startup checks. The Docker runtime stage sets
 * NODE_ENV=production, so a deployed gateway refuses to boot with
 * default-permissive secrets; dev and tests keep booting with defaults.
 */
function assertProductionEnv(corsOrigin: string): void {
  const pepper = process.env.API_HMAC_PEPPER;
  if (!pepper || pepper === DEFAULT_HMAC_PEPPER) {
    throw new Error(
      'API_HMAC_PEPPER must be set to a non-default value in production (generate with: openssl rand -hex 32)',
    );
  }
  if (!process.env.API_KEY_ALLOWLIST?.trim()) {
    throw new Error(
      'API_KEY_ALLOWLIST must be set in production — leaving it unset opens API key issuance to anyone',
    );
  }
  if (corsOrigin === '*') {
    throw new Error('API_CORS_ORIGIN must not be the wildcard default in production');
  }
}
