/**
 * Indexer entry point — Phase 1 skeleton.
 *
 * Phase 1 establishes lifecycle, config, db, and migrations only.
 * The polling loop, event router, and handlers ship in Phase 2.
 */

import pino from 'pino';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { runMigrations } from './migrations.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = pino({ level: config.logLevel });

  log.info(
    {
      network: config.network,
      rpcUrl: config.rpcUrl,
      pollIntervalMs: config.pollIntervalMs,
      market: config.contracts.contracts.market,
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

  // TODO Phase 2: start poll loop, event router, handlers, bus.
  log.info('Indexer skeleton ready (Phase 1). Polling loop lands in Phase 2.');

  const shutdown = (signal: string): void => {
    log.info({ signal }, 'Shutting down');
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Phase 1 stub keeps the process alive for one minute then exits cleanly,
  // so it can be deployed and observed without blocking on a real loop.
  await new Promise((r) => setTimeout(r, 60_000));
  shutdown('idle-exit');
}

main().catch((err) => {
  console.error('Indexer fatal error:', err);
  process.exit(1);
});
