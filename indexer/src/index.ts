/**
 * Indexer entry point.
 *
 * Boots: config → Postgres → migrations → RPC → router → handlers (market
 * + LP vault + vault factory + referral, conditional on contracts.json
 * having addresses) → poll loop. Captures every event the protocol emits
 * into events_raw and forwards them to the in process bus.
 */

import pino from 'pino';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { runMigrations } from './migrations.js';
import { createRpcPool } from './rpc.js';
import { startHealthServer } from './health.js';
import { IndexerBus } from './bus.js';
import { EventRouter } from './router.js';
import { buildMarketRegistrations } from './handlers/market.js';
import { buildVaultRegistrations } from './handlers/vault.js';
import { buildReferralRegistrations } from './handlers/referral.js';
import { buildLpVaultRegistrations } from './handlers/lpVault.js';
import { IndexerPoller } from './poll.js';
import { CandleAggregator } from './candles/aggregator.js';
import { pruneRetiredFactoryRows, reconcileAllVaults } from './vaultSync.js';
import { getContract, getNetworkPassphrase, hasContract, resolvedContracts } from '@noether/shared';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = pino({ level: config.logLevel });

  // Resolve through getContract so CONTRACT_* env overrides take effect —
  // the manifest is baked into the Docker image at build, so overrides are
  // the only way to re-point a running indexer without a rebuild (D-4).
  log.info(
    { resolved: resolvedContracts(['market', 'vault', 'vaultFactory', 'referral'], config.contracts) },
    'Resolved contract addresses',
  );
  const market = getContract('market', config.contracts);
  // vault_factory and referral are optional — they appear once their
  // respective testnet deploys land. The router registers handlers
  // conditionally so the indexer is useful before Phase 10/11 contracts.
  const vaultFactory = hasContract('vaultFactory', config.contracts)
    ? getContract('vaultFactory', config.contracts)
    : undefined;
  const referral = hasContract('referral', config.contracts)
    ? getContract('referral', config.contracts)
    : undefined;
  // The LP vault (USDC liquidity pool the market settles against). The
  // manifest key is `vault`, overridable via CONTRACT_VAULT. Optional for
  // the same reason as the factory and referral above.
  const lpVault = hasContract('vault', config.contracts)
    ? getContract('vault', config.contracts)
    : undefined;

  const contractIds: string[] = [market];
  if (lpVault) contractIds.push(lpVault);
  if (vaultFactory) contractIds.push(vaultFactory);
  if (referral) contractIds.push(referral);

  log.info(
    {
      network: config.network,
      rpcUrls: config.rpcUrls,
      pollIntervalMs: config.pollIntervalMs,
      market,
      lpVault: lpVault ?? '(not deployed)',
      vaultFactory: vaultFactory ?? '(not deployed)',
      referral: referral ?? '(not deployed)',
    },
    'Indexer starting',
  );

  const db = createDb(config);
  const { applied } = await runMigrations(db);
  if (applied.length > 0) {
    log.info({ count: applied.length, migrations: applied.map((m) => m.filename) }, 'Applied migrations');
  } else {
    log.info('Schema up to date');
  }

  // Native Noeracle candle aggregator (independent of the market address — it
  // polls the Noeracle price API, not on-chain events). Writes the candles
  // projection read by the api's /v1/candles.
  const aggregator = config.candles.enabled
    ? new CandleAggregator({
        db,
        log,
        noeracleApiUrl: config.noeracleApiUrl,
        assets: config.candles.assets,
        pollIntervalMs: config.candles.pollIntervalMs,
        seedBars: config.candles.seedBars,
      })
    : undefined;

  const rpcPool = createRpcPool(config.rpcUrls);
  const rpc = rpcPool.current();
  const bus = new IndexerBus();
  const router = new EventRouter();

  for (const reg of buildMarketRegistrations(market)) {
    router.register(reg.contractId, reg.topic, reg.handler);
  }
  if (lpVault) {
    for (const reg of buildLpVaultRegistrations(lpVault)) {
      router.register(reg.contractId, reg.topic, reg.handler);
    }
    log.info({ contract: lpVault }, 'LP vault handlers registered');
  }
  if (vaultFactory) {
    for (const reg of buildVaultRegistrations(vaultFactory)) {
      router.register(reg.contractId, reg.topic, reg.handler);
    }
    log.info({ contract: vaultFactory }, 'Vault factory handlers registered');
    // Scope the factory projections to the live factory BEFORE the on
    // chain reconcile: rows from a retired factory would survive it
    // (view_vault fails for ids the live factory never issued, leaving
    // the stale row untouched) and keep surfacing as phantom vaults.
    try {
      await pruneRetiredFactoryRows(db, vaultFactory, log);
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'Retired factory prune failed');
    }
    // Boot-time reconcile: rewrite every vaults row from the canonical
    // on-chain state so any projection drift from older codepaths (no
    // leader_open decrement / migration 009's incomplete subtraction)
    // is corrected before the live polling resumes.
    try {
      await reconcileAllVaults(db, rpc, vaultFactory, getNetworkPassphrase(config.network), log);
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'Boot-time vault reconcile failed');
    }
  }
  if (referral) {
    for (const reg of buildReferralRegistrations(referral)) {
      router.register(reg.contractId, reg.topic, reg.handler);
    }
    log.info({ contract: referral }, 'Referral handlers registered');
  }

  const poller = new IndexerPoller({
    db,
    rpcPool,
    bus,
    router,
    log,
    contractIds,
    marketContract: market,
    vaultFactoryContract: vaultFactory,
    referralContract: referral,
    lpVaultContract: lpVault,
    pollIntervalMs: config.pollIntervalMs,
    coldStartLedgers: config.coldStartLedgers,
    retentionWarnLedgers: config.retentionWarnLedgers,
  });

  const healthServer = startHealthServer({
    port: config.healthPort,
    db,
    log,
    maxPollAgeMs: Math.max(60_000, config.pollIntervalMs * 10),
    source: poller,
    aggregator,
  });

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'Shutting down');
    poller.stop();
    aggregator?.stop();
    healthServer.close();
    await db.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  if (aggregator) {
    void aggregator.start();
    log.info(
      { assets: config.candles.assets.length, pollIntervalMs: config.candles.pollIntervalMs },
      'Candle aggregator started',
    );
  } else {
    log.info('Candle aggregator disabled (CANDLE_AGGREGATOR_ENABLED=false)');
  }

  await poller.start();
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('Indexer fatal error:', err);
  process.exit(1);
});
