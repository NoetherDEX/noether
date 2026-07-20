/**
 * Noether Keeper Bot - Configuration
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { KeeperConfig, AssetConfig, KeySource } from './types';

// Load .env - try local first, then project root (for monorepo)
dotenv.config(); // loads .env from cwd (Railway sets env vars directly)
const projectRoot = path.resolve(__dirname, '../../../');
dotenv.config({ path: path.join(projectRoot, '.env') }); // fallback for monorepo

// Default assets to monitor, with per-asset publish-path defenses (K-2):
// maxMovePct = max % move vs last pushed price per push interval (env-tunable
// via MAX_MOVE_PCT_<SYMBOL>); min/maxPrice = absolute sanity band in USD.
const DEFAULT_ASSETS: AssetConfig[] = [
  { symbol: 'BTC', decimals: 8, maxMovePct: 10, minPrice: 1_000, maxPrice: 1_000_000 },
  { symbol: 'ETH', decimals: 8, maxMovePct: 10, minPrice: 50, maxPrice: 100_000 },
  { symbol: 'XLM', decimals: 7, maxMovePct: 20, minPrice: 0.01, maxPrice: 100 },
  // Bands mirror noether_router::price_bounds — keep the two in lockstep.
  { symbol: 'SOL', decimals: 7, maxMovePct: 20, minPrice: 1, maxPrice: 100_000 },
  { symbol: 'XRP', decimals: 7, maxMovePct: 20, minPrice: 0.01, maxPrice: 1_000 },
  { symbol: 'ADA', decimals: 7, maxMovePct: 20, minPrice: 0.01, maxPrice: 1_000 },
  { symbol: 'BNB', decimals: 7, maxMovePct: 20, minPrice: 10, maxPrice: 100_000 },
  { symbol: 'TRX', decimals: 7, maxMovePct: 20, minPrice: 0.01, maxPrice: 1_000 },
  { symbol: 'HYPE', decimals: 7, maxMovePct: 20, minPrice: 0.1, maxPrice: 100_000 },
  { symbol: 'DOGE', decimals: 7, maxMovePct: 20, minPrice: 0.001, maxPrice: 100 },
  { symbol: 'ZEC', decimals: 7, maxMovePct: 20, minPrice: 1, maxPrice: 100_000 },
  { symbol: 'LINK', decimals: 7, maxMovePct: 20, minPrice: 0.1, maxPrice: 10_000 },
  { symbol: 'BCH', decimals: 7, maxMovePct: 20, minPrice: 1, maxPrice: 100_000 },
  { symbol: 'LTC', decimals: 7, maxMovePct: 20, minPrice: 1, maxPrice: 100_000 },
];

function envInt(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envFloat(name: string, fallback: number): number {
  const parsed = parseFloat(process.env[name] || '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveAssets(): AssetConfig[] {
  return DEFAULT_ASSETS.map((asset) => ({
    ...asset,
    maxMovePct: envFloat(`MAX_MOVE_PCT_${asset.symbol}`, asset.maxMovePct),
  }));
}

/**
 * Resolve the signing key. Resolution order is unchanged
 * (KEEPER_SECRET_KEY → ORACLE_SECRET_KEY → ADMIN_SECRET_KEY) but (K-8):
 * - no fragment of the secret is EVER logged — only the source env var;
 * - the ADMIN_SECRET_KEY fallback warns loudly on testnet and hard-fails
 *   on mainnet (the admin key is the issuer + market admin — a keeper box
 *   compromise must not equal full protocol compromise).
 */
function resolveSigningKey(network: string): { secretKey: string; keySource: KeySource } {
  let rawKey: string | undefined;
  let keySource: KeySource = 'KEEPER_SECRET_KEY';

  if (process.env.KEEPER_SECRET_KEY) {
    rawKey = process.env.KEEPER_SECRET_KEY;
    keySource = 'KEEPER_SECRET_KEY';
  } else if (process.env.ORACLE_SECRET_KEY) {
    rawKey = process.env.ORACLE_SECRET_KEY;
    keySource = 'ORACLE_SECRET_KEY';
  } else if (process.env.ADMIN_SECRET_KEY) {
    rawKey = process.env.ADMIN_SECRET_KEY;
    keySource = 'ADMIN_SECRET_KEY';
  }

  if (!rawKey) {
    throw new Error('❌ KEEPER_SECRET_KEY, ORACLE_SECRET_KEY, or ADMIN_SECRET_KEY must be set in .env');
  }

  // Strip quotes, whitespace, newlines that Railway might inject.
  // Never log any part of the secret (K-8) — only where it came from.
  const secretKey = rawKey.replace(/['"\s\n\r]/g, '').trim();
  console.log(`🔑 Signing key source: ${keySource}`);

  if (keySource === 'ADMIN_SECRET_KEY') {
    if (network === 'mainnet') {
      console.error('❌ Refusing to run: NETWORK=mainnet with the signing key resolved from the');
      console.error('   ADMIN_SECRET_KEY fallback. The admin key is the asset issuer and market');
      console.error('   admin — set a dedicated KEEPER_SECRET_KEY (or ORACLE_SECRET_KEY) instead.');
      process.exit(1);
    }
    console.warn('⚠️  Signing with the ADMIN_SECRET_KEY fallback — use a dedicated keeper key');
    console.warn('   (sequence conflicts during deploys + unnecessary blast radius).');
  }

  return { secretKey, keySource };
}

/**
 * RPC endpoints (K-6): SOROBAN_RPC_URLS (comma-separated, primary first)
 * wins; falls back to SOROBAN_RPC_URL, then legacy RPC_URL, then the
 * public testnet endpoint. The client rotates through the list on
 * transient failures.
 */
function resolveRpcUrls(): string[] {
  const list = (process.env.SOROBAN_RPC_URLS || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  if (list.length > 0) return list;

  const single = process.env.SOROBAN_RPC_URL || process.env.RPC_URL;
  return [single || 'https://soroban-testnet.stellar.org'];
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
    console.log('📄 Loaded contract addresses from contracts.json');
  }

  const network = (process.env.NETWORK || 'testnet') as 'testnet' | 'mainnet';
  const { secretKey, keySource } = resolveSigningKey(network);
  const rpcUrls = resolveRpcUrls();

  const config: KeeperConfig = {
    // Network configuration
    network,
    rpcUrl: rpcUrls[0],
    rpcUrls,
    networkPassphrase: process.env.NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',

    // Credentials
    secretKey,
    keySource,

    // Contract addresses (from env or contracts.json)
    marketContractId:
      process.env.NEXT_PUBLIC_MARKET_ID ||
      contracts.contracts?.market ||
      '',
    // Noeracle on-chain contract — keeper publishes signed attestation
    // batches here via the hardened update_batch_ed25519_persistent, which
    // only exists on post-S-1 Noeracle deployments. No hardcoded fallback:
    // an unset or legacy address is a boot error (validated below), never a
    // silent publish-to-nowhere.
    noeracleContractId:
      process.env.NEXT_PUBLIC_NOERACLE_ID ||
      contracts.contracts?.noeracle ||
      '',
    vaultContractId:
      process.env.NEXT_PUBLIC_VAULT_ID ||
      contracts.contracts?.vault ||
      '',
    // Vault factory — enables the L0-20 order-reconcile duty; empty is
    // fine on stacks without user vaults (duty stays disabled).
    vaultFactoryContractId:
      process.env.NEXT_PUBLIC_VAULT_FACTORY_ID ||
      contracts.contracts?.vaultFactory ||
      '',
    // Router + shim — extended alongside market/vault by the TTL job (P3-9).
    routerContractId:
      process.env.NEXT_PUBLIC_NOETHER_ROUTER_ID ||
      contracts.contracts?.noetherRouter ||
      '',
    shimContractId:
      process.env.NEXT_PUBLIC_NOERACLE_SHIM_ID ||
      contracts.contracts?.noeracleShim ||
      '',

    // Timing
    pollIntervalMs: envInt('POLL_INTERVAL_MS', 5000),
    oracleUpdateIntervalMs: envInt('ORACLE_UPDATE_INTERVAL_MS', 30000),

    // ADL manager (L0-1). Defaults mirror the MarketConfig contract
    // defaults (12_500 = flag when coverage < 1.25× payable uPnL, clear
    // above 1.5×) — advisory only, the on-chain gate is the consensus.
    adlTriggerRatioBps: envInt('ADL_TRIGGER_RATIO_BPS', 12_500),
    adlClearRatioBps: envInt('ADL_CLEAR_RATIO_BPS', 15_000),
    adlMaxClosesPerCycle: envInt('ADL_MAX_CLOSES_PER_CYCLE', 5),
    adlCheckIntervalMs: envInt('ADL_CHECK_INTERVAL_MS', 30_000),

    // TTL bump job (P3-9) + wallet-funding alarm (P3-10)
    ttlBumpIntervalMs: envInt('TTL_BUMP_INTERVAL_MS', 6 * 60 * 60 * 1000), // 6h
    ttlExtendToLedgers: envInt('TTL_EXTEND_TO_LEDGERS', 518_400), // ~30 days
    minKeeperXlm: envFloat('MIN_KEEPER_XLM', 20),

    // Active-active + liveness (L0-19). NOTE: pollOffsetMs defaults to 0 —
    // the spec's "default POLL_INTERVAL_MS/2" reading would give BOTH
    // instances the same offset and no stagger; set it explicitly (~2500)
    // on the second instance only.
    instanceId: process.env.KEEPER_INSTANCE_ID || 'keeper-1',
    pollOffsetMs: envInt('KEEPER_POLL_OFFSET_MS', 0),
    triggeredStuckAlertCycles: envInt('TRIGGERED_STUCK_ALERT_CYCLES', 3),
    healthcheckUrl: process.env.HEALTHCHECK_URL || '',

    // Reliability (K-1). The default watchdog scales with the asset count:
    // a full oracle pass costs ~10-12s per asset (tx confirm + NAV sync +
    // inter-asset delay), so the old flat 3 minutes was only right for 3
    // assets — with 14 it killed the keeper mid-cycle every cycle.
    watchdogTimeoutMs: envInt(
      'WATCHDOG_TIMEOUT_MS',
      Math.max(3 * 60 * 1000, resolveAssets().length * 60 * 1000),
    ),
    alertErrorStreak: envInt('ALERT_ERROR_STREAK', 5),

    // Publish-path defenses (K-2)
    stateFilePath: path.resolve(process.cwd(), process.env.KEEPER_STATE_FILE || './keeper-state.json'),
    referenceTickerUrl:
      process.env.REFERENCE_TICKER_URL || 'https://api.binance.com/api/v3/ticker/price',
    referenceDivergencePct: envFloat('REFERENCE_DIVERGENCE_PCT', 5),

    // L0-9 interim smoothing: two-strike liquidation confirm + spike alert.
    triggerConfirmReads: Math.max(1, envInt('KEEPER_TRIGGER_CONFIRM_READS', 2)),
    spikeAlertPct: envFloat('KEEPER_SPIKE_ALERT_PCT', 1.5),

    // Stork secondary oracle (T3-D1). Empty key = disabled = the keeper
    // runs Noeracle-only, exactly as before — fail-open by design.
    storkApiKey: process.env.STORK_API_KEY || '',
    storkRestUrl: process.env.STORK_REST_URL || 'https://rest.jp.stork-oracle.network',
    storkMaxDivergencePct: envFloat('STORK_MAX_DIVERGENCE_PCT', 1.5),
    storkMaxAgeMs: envInt('STORK_MAX_AGE_MS', 120_000),

    // Oracle-health heartbeat (T3-D1): POSTed to the api gateway after
    // every oracle cycle. Empty URL = disabled — fire-and-forget either way.
    heartbeatUrl: process.env.KEEPER_HEARTBEAT_URL || '',
    heartbeatSecret: process.env.KEEPER_HEARTBEAT_SECRET || '',

    // Alerting (K-1)
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || undefined,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
    telegramChatId: process.env.TELEGRAM_CHAT_ID || undefined,

    // Assets
    assets: resolveAssets(),
  };

  // Validate contract addresses
  if (!config.marketContractId) {
    console.warn('⚠️  Warning: MARKET_CONTRACT_ID not set. Liquidations and orders will not work.');
  }
  // Price publishing is this keeper's core duty and the market's only price
  // source — fail fast instead of running a keeper that cannot publish.
  if (!config.noeracleContractId) {
    throw new Error(
      'Noeracle contract id not set. Set NEXT_PUBLIC_NOERACLE_ID (or contracts.json .contracts.noeracle) ' +
        'to a post-S-1 Noeracle deployment — price publishing cannot work without it.',
    );
  }
  // The pre-S-1 contract does not export update_batch_ed25519_persistent;
  // every publish would fail on-chain. Refuse it at boot (L0-7 cutover trap).
  const LEGACY_PRE_S1_NOERACLE = 'CAYIP67UDVX5UPXGN3XDAWVIEFBAVG6G7LUESEOU3NUQKTWN55W34YBG';
  if (config.noeracleContractId === LEGACY_PRE_S1_NOERACLE) {
    throw new Error(
      `Noeracle contract id ${LEGACY_PRE_S1_NOERACLE} is the LEGACY pre-S-1 deployment — it lacks the ` +
        'hardened batch entrypoint this keeper publishes through. Point NEXT_PUBLIC_NOERACLE_ID at the ' +
        'hardened Noeracle (see the L0-7 cutover runbook).',
    );
  }
  if (config.storkApiKey) {
    console.log('🔐 Stork secondary oracle ENABLED (dual-source cross-validation active)');
  } else {
    console.log('ℹ️  Stork secondary oracle disabled (no STORK_API_KEY) — running Noeracle-only');
  }

  return config;
}

export default loadConfig;
