import 'dotenv/config';
import type { Network } from '@noether/types';
import { getRpcUrls, loadContracts, SUPPORTED_ASSET_SYMBOLS, type ContractsManifest } from '@noether/shared';

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
  noeracleApiUrl: string;
  candles: {
    enabled: boolean;
    assets: string[];
    pollIntervalMs: number;
    seedBars: number;
  };
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
    noeracleApiUrl:
      process.env.NOERACLE_API_URL ??
      process.env.NEXT_PUBLIC_NOERACLE_API_URL ??
      'https://api.noeracle.org',
    candles: {
      enabled: (process.env.CANDLE_AGGREGATOR_ENABLED ?? 'true') !== 'false',
      assets: parseCandleAssets(process.env.CANDLE_ASSETS),
      pollIntervalMs: Number(process.env.CANDLE_POLL_INTERVAL_MS ?? 3000),
      seedBars: Number(process.env.CANDLE_SEED_BARS ?? 1000),
    },
    contracts,
    logLevel: process.env.INDEXER_LOG_LEVEL ?? 'info',
  };
}

function parseCandleAssets(raw: string | undefined): string[] {
  const parsed = (raw ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : [...SUPPORTED_ASSET_SYMBOLS];
}
