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
  { symbol: 'BTC', decimals: 8, maxJumpPct: 0.10, binanceSymbol: 'BTCUSDT' },
  { symbol: 'ETH', decimals: 8, maxJumpPct: 0.10, binanceSymbol: 'ETHUSDT' },
  { symbol: 'XLM', decimals: 7, maxJumpPct: 0.15, binanceSymbol: 'XLMUSDT' },
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

  // Resolve the network robustly: NETWORK may arrive mis-cased or whitespace-
  // padded (Railway injects newlines), and the keeper actually SIGNS against
  // whatever NETWORK_PASSPHRASE/RPC point at — so treat the mainnet passphrase as
  // authoritative regardless of the NETWORK string (K-8).
  const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
  const networkPassphrase = (process.env.NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015').trim();
  const networkLabel = (process.env.NETWORK || 'testnet').trim().toLowerCase();
  const isMainnet = networkLabel === 'mainnet' || networkPassphrase === MAINNET_PASSPHRASE;

  // Validate required environment variables. Privilege separation (K-8): the
  // keeper must use a DEDICATED key on mainnet, never the admin key.
  const keeperKey = process.env.KEEPER_SECRET_KEY || process.env.ORACLE_SECRET_KEY;
  const rawKey = keeperKey || process.env.ADMIN_SECRET_KEY;
  if (!rawKey) {
    throw new Error('❌ KEEPER_SECRET_KEY, ORACLE_SECRET_KEY, or ADMIN_SECRET_KEY must be set in .env');
  }
  if (isMainnet && !keeperKey) {
    throw new Error('❌ Refusing to run against mainnet with the admin key — set a dedicated KEEPER_SECRET_KEY (K-8).');
  }
  // Strip quotes, whitespace, newlines that Railway might inject.
  const secretKey = rawKey.replace(/['"\s\n\r]/g, '').trim();
  // Never log key material (not even fragments) — the keeper address is logged
  // separately at startup from the derived public key (K-8).
  console.log(`🔑 Keeper key loaded (${secretKey.length} chars).`);

  const config: KeeperConfig = {
    // Network configuration (normalized + passphrase-derived, K-8)
    network: isMainnet ? 'mainnet' : 'testnet',
    rpcUrl: process.env.RPC_URL || 'https://soroban-testnet.stellar.org',
    networkPassphrase,

    // Credentials
    secretKey,

    // Contract addresses (from env or contracts.json)
    marketContractId:
      process.env.NEXT_PUBLIC_MARKET_ID ||
      contracts.contracts?.market ||
      '',
    // Noeracle on-chain contract — keeper publishes signed attestations
    // here via update_ed25519_persistent. Defaults to the live testnet
    // deployment so the bot works out-of-the-box.
    noeracleContractId:
      process.env.NEXT_PUBLIC_NOERACLE_ID ||
      contracts.contracts?.noeracle ||
      'CAYIP67UDVX5UPXGN3XDAWVIEFBAVG6G7LUESEOU3NUQKTWN55W34YBG',
    vaultContractId:
      process.env.NEXT_PUBLIC_VAULT_ID ||
      contracts.contracts?.vault ||
      '',

    // Timing
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '5000', 10),
    oracleUpdateIntervalMs: parseInt(process.env.ORACLE_UPDATE_INTERVAL_MS || '30000', 10),
    watchdogMs: parseInt(process.env.WATCHDOG_MS || '180000', 10), // 3 min

    // Alerting (optional Discord/Slack webhook)
    alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || undefined,

    // Publish-path defenses (K-2)
    stateFile: process.env.KEEPER_STATE_FILE || './.keeper-state.json',
    referenceDivergencePct: parseFloat(process.env.REFERENCE_DIVERGENCE_PCT || '0.03'),

    // Assets
    assets: DEFAULT_ASSETS,
  };

  // Validate contract addresses
  if (!config.marketContractId) {
    console.warn('⚠️  Warning: MARKET_CONTRACT_ID not set. Liquidations and orders will not work.');
  }
  if (!config.noeracleContractId) {
    console.warn('⚠️  Warning: NOERACLE_CONTRACT_ID not set. Price publishing will not work.');
  }

  return config;
}

export default loadConfig;
