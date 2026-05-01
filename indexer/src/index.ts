/**
 * Indexer entry point — Phase 2 v0.
 *
 * Boots: config → libsql → migrations → RPC → router → market handlers
 * → poll loop. Captures market events into events_raw and forwards them
 * to the in-process bus. Trades, candles, and per-trader projections
 * land in Phase 3 once the API needs them.
 */

import pino from 'pino';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { runMigrations } from './migrations.js';
import { createRpc } from './rpc.js';
import { IndexerBus } from './bus.js';
import { EventRouter } from './router.js';
import { buildMarketRegistrations } from './handlers/market.js';
import { IndexerPoller } from './poll.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = pino({ level: config.logLevel });

  const market = config.contracts.contracts.market;
  log.info(
    {
      network: config.network,
      rpcUrl: config.rpcUrl,
      pollIntervalMs: config.pollIntervalMs,
      market,
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

  const poller = new IndexerPoller({
    db,
    rpc,
    bus,
    router,
    log,
    contractIds: [market],
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

  // Block forever — the poll loop runs until SIGINT/SIGTERM.
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('Indexer fatal error:', err);
  process.exit(1);
});
