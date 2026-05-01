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
  contracts: ContractsManifest;
}

export function loadConfig(): ApiConfig {
  return {
    network: (process.env.NETWORK ?? 'testnet') as Network,
    host: process.env.API_HOST ?? '0.0.0.0',
    port: Number(process.env.API_PORT ?? 4000),
    logLevel: process.env.API_LOG_LEVEL ?? 'info',
    corsOrigin: process.env.API_CORS_ORIGIN ?? '*',
    rpcUrl: process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    contracts: loadContracts(),
  };
}
