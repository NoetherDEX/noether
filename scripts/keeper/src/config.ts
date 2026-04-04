/**
 * Noether Keeper Bot - Configuration
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { KeeperConfig, AssetConfig } from './types';

// Load .env - try local first, then project root (for monorepo)
dotenv.config(); // loads .env from cwd (Railway sets env vars directly)
const projectRoot = path.resolve(__dirname, '../../../');
dotenv.config({ path: path.join(projectRoot, '.env') }); // fallback for monorepo

// Default assets to monitor
const DEFAULT_ASSETS: AssetConfig[] = [
  { symbol: 'BTC', binanceSymbol: 'BTCUSDT', decimals: 8 },
  { symbol: 'ETH', binanceSymbol: 'ETHUSDT', decimals: 8 },
  { symbol: 'XLM', binanceSymbol: 'XLMUSDT', decimals: 7 },
];

/**
 * Load and validate configuration
 */
export function loadConfig(): KeeperConfig {
  // Try to load contracts.json
  const contractsPath = path.join(projectRoot, 'contracts.json');
  let contracts: any = {};

  if (fs.existsSync(contractsPath)) {
    contracts = JSON.parse(fs.readFileSync(contractsPath, 'utf-8'));
    console.log('📄 Loaded contract addresses from contracts.json');
  }

  // Validate required environment variables
  const rawKey = process.env.KEEPER_SECRET_KEY || process.env.ORACLE_SECRET_KEY || process.env.ADMIN_SECRET_KEY;
  if (!rawKey) {
    throw new Error('❌ KEEPER_SECRET_KEY, ORACLE_SECRET_KEY, or ADMIN_SECRET_KEY must be set in .env');
  }
  // Strip quotes, whitespace, newlines that Railway might inject
  const secretKey = rawKey.replace(/['"\s\n\r]/g, '').trim();
  console.log(`🔑 Key loaded: ${secretKey.substring(0, 4)}...${secretKey.substring(secretKey.length - 4)} (${secretKey.length} chars)`);

  const config: KeeperConfig = {
    // Network configuration
    network: (process.env.NETWORK || 'testnet') as 'testnet' | 'mainnet',
    rpcUrl: process.env.RPC_URL || 'https://soroban-testnet.stellar.org',
    networkPassphrase: process.env.NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',

    // Credentials
    secretKey,

    // Contract addresses (from env or contracts.json)
    marketContractId:
      process.env.NEXT_PUBLIC_MARKET_ID ||
      contracts.contracts?.market ||
      '',
    oracleContractId:
      process.env.NEXT_PUBLIC_MOCK_ORACLE_ID ||
      contracts.contracts?.mockOracle ||
      '',
    vaultContractId:
      process.env.NEXT_PUBLIC_VAULT_ID ||
      contracts.contracts?.vault ||
      '',

    // Timing
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '5000', 10),
    oracleUpdateIntervalMs: parseInt(process.env.ORACLE_UPDATE_INTERVAL_MS || '30000', 10),

    // Reflector oracle
    reflectorContractId:
      process.env.REFLECTOR_CONTRACT_ID ||
      'CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63',

    // Assets
    assets: DEFAULT_ASSETS,
  };

  // Validate contract addresses
  if (!config.marketContractId) {
    console.warn('⚠️  Warning: MARKET_CONTRACT_ID not set. Liquidations and orders will not work.');
  }
  if (!config.oracleContractId) {
    console.warn('⚠️  Warning: ORACLE_CONTRACT_ID not set. Price updates will not work.');
  }

  return config;
}

export default loadConfig;
