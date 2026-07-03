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

/**
 * Fail-closed in production (P0-13/P0-14): refuse to boot with insecure default
 * or missing secrets. Staging runs as production, so this gates the deploy — the
 * api won't start until these are set in the service environment. No-op outside
 * production, so local/dev/test are unaffected.
 */
function assertProductionSecrets(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const problems: string[] = [];
  const pepper = process.env.API_HMAC_PEPPER;
  if (!pepper || pepper === 'change-me-in-production') {
    problems.push('API_HMAC_PEPPER (unset or default)');
  }
  if (!process.env.API_CORS_ORIGIN || process.env.API_CORS_ORIGIN === '*') {
    problems.push('API_CORS_ORIGIN (unset or "*")');
  }
  // The closed-beta allowlist is required unless open issuance is opted in explicitly.
  if (process.env.API_ALLOW_OPEN_ISSUANCE !== 'true' && !process.env.API_KEY_ALLOWLIST?.trim()) {
    problems.push('API_KEY_ALLOWLIST (unset/empty; set API_ALLOW_OPEN_ISSUANCE=true to allow open issuance)');
  }
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production with insecure config: ${problems.join('; ')}. ` +
        'Set these in the api service environment.',
    );
  }
}

export function loadConfig(): ApiConfig {
  assertProductionSecrets();
  const contracts = loadContracts();
  const network = (process.env.NETWORK ?? 'testnet') as Network;
  const rpcUrls = getRpcUrls(network);
  return {
    network,
    host: process.env.API_HOST ?? '0.0.0.0',
    port: Number(process.env.API_PORT ?? 4000),
    logLevel: process.env.API_LOG_LEVEL ?? 'info',
    corsOrigin: process.env.API_CORS_ORIGIN ?? '*',
    rpcUrls,
    rpcUrl: rpcUrls[0]!,
    sourceAccount: process.env.API_SOURCE_ACCOUNT ?? contracts.admin,
    libsqlUrl: process.env.LIBSQL_URL ?? 'file:../indexer/data/indexer.db',
    libsqlAuthToken: process.env.LIBSQL_AUTH_TOKEN || undefined,
    contracts,
  };
}
