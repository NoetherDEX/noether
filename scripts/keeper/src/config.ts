/**
 * Keeper Bot Configuration
 *
 * Loads configuration from environment variables and contracts.json
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load .env from project root
const projectRoot = path.resolve(__dirname, '../../../');
dotenv.config({ path: path.join(projectRoot, '.env') });

export interface KeeperConfig {
  // Network
  network: 'testnet' | 'mainnet';
  rpcUrl: string;
  networkPassphrase: string;

  // Keeper credentials
  secretKey: string;
  publicKey: string;

  // Contract addresses
  marketContractId: string;
  oracleContractId: string;
  vaultContractId: string;

  // Keeper settings
  pollIntervalMs: number;
  minKeeperReward: bigint;
  maxGasPrice: number;
}

/**
 * Load and validate configuration
 */
export function loadConfig(): KeeperConfig {
  // Try to load contracts.json
  const contractsPath = path.join(projectRoot, 'contracts.json');
  let contracts: any = {};

  if (fs.existsSync(contractsPath)) {
    contracts = JSON.parse(fs.readFileSync(contractsPath, 'utf-8'));
    console.log('Loaded contract addresses from contracts.json');
  }

  // Validate required environment variables
  const secretKey = process.env.KEEPER_SECRET_KEY || process.env.ADMIN_SECRET_KEY;
  if (!secretKey) {
    throw new Error('KEEPER_SECRET_KEY or ADMIN_SECRET_KEY must be set');
  }

  const config: KeeperConfig = {
    // Network configuration
    network: (process.env.NETWORK || 'testnet') as 'testnet' | 'mainnet',
    rpcUrl: process.env.RPC_URL || 'https://soroban-testnet.stellar.org',
    networkPassphrase: process.env.NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',

    // Credentials
    secretKey,
    publicKey: '', // Will be derived

    // Contract addresses (from env or contracts.json)
    marketContractId:
      process.env.NEXT_PUBLIC_MARKET_ID ||
      contracts.contracts?.market ||
      '',
    oracleContractId:
      process.env.NEXT_PUBLIC_ORACLE_ADAPTER_ID ||
      contracts.contracts?.oracleAdapter ||
      '',
    vaultContractId:
      process.env.NEXT_PUBLIC_VAULT_ID ||
      contracts.contracts?.vault ||
      '',

    // Keeper settings
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '10000', 10),
    minKeeperReward: BigInt(process.env.MIN_KEEPER_REWARD || '1000000'), // 0.1 USDC
    maxGasPrice: parseInt(process.env.MAX_GAS_PRICE || '100', 10),
  };

  // Validate contract addresses
  if (!config.marketContractId) {
    console.warn('Warning: MARKET_CONTRACT_ID not set. Run deployment first.');
  }

  return config;
}

export default loadConfig;
