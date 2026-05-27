/**
 * Indexer entry point.
 *
 * Boots: config → libsql → migrations → RPC → router → handlers (market
 * + vault + referral, conditional on contracts.json having addresses) →
 * poll loop. Captures every event the protocol emits into events_raw
 * and forwards them to the in-process bus.
 */

import pino from 'pino';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { runMigrations } from './migrations.js';
import { createRpc } from './rpc.js';
import { IndexerBus } from './bus.js';
import { EventRouter } from './router.js';
import { buildMarketRegistrations } from './handlers/market.js';
import { buildVaultRegistrations } from './handlers/vault.js';
import { buildReferralRegistrations } from './handlers/referral.js';
import { IndexerPoller } from './poll.js';
import { reconcileAllVaults } from './vaultSync.js';
import { getNetworkPassphrase } from '@noether/shared';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = pino({ level: config.logLevel });

  const market = config.contracts.contracts.market;
  // vault_factory and referral are optional in contracts.json — they
  // appear once their respective testnet deploys land. The router
  // registers handlers conditionally so the indexer is useful before
  // Phase 10/11 contracts are live.
  const vaultFactory = config.contracts.contracts.vaultFactory;
  const referral = config.contracts.contracts.referral;

  const contractIds: string[] = [market];
  if (vaultFactory) contractIds.push(vaultFactory);
  if (referral) contractIds.push(referral);

  log.info(
    {
      network: config.network,
      rpcUrl: config.rpcUrl,
      pollIntervalMs: config.pollIntervalMs,
      market,
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

  const rpc = createRpc(config.rpcUrl);
  const bus = new IndexerBus();
  const router = new EventRouter();

  for (const reg of buildMarketRegistrations(market)) {
    router.register(reg.contractId, reg.topic, reg.handler);
  }
  if (vaultFactory) {
    for (const reg of buildVaultRegistrations(vaultFactory)) {
      router.register(reg.contractId, reg.topic, reg.handler);
    }
    log.info({ contract: vaultFactory }, 'Vault factory handlers registered');
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
    rpc,
    bus,
    router,
    log,
    contractIds,
    marketContract: market,
    vaultFactoryContract: vaultFactory,
    referralContract: referral,
    pollIntervalMs: config.pollIntervalMs,
    coldStartLedgers: config.coldStartLedgers,
  });

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'Shutting down');
    poller.stop();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await poller.start();
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('Indexer fatal error:', err);
  process.exit(1);
});
