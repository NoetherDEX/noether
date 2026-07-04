/**
 * Rebuild every projection table from the events_raw archive (I-7).
 *
 * Truncates the projections, then replays events_raw through the same
 * handlers the live poller uses, with ctx.replay set so the events_raw
 * duplicate guard is bypassed and bus emissions are suppressed (a
 * rebuild must not spam WS consumers). Events from contracts that are
 * no longer in the manifest simply match no registration and are
 * skipped — projections come out scoped to the current deployment.
 *
 * Stop the live indexer before running: two writers double-apply.
 *
 * Usage: npm -w @noether/indexer run reindex
 */

import pino from 'pino';
import type { Logger } from 'pino';
import type { Client, Row } from '@libsql/client';
import type { rpc as RpcNs } from '@stellar/stellar-sdk';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { runMigrations } from './migrations.js';
import { createRpc } from './rpc.js';
import { IndexerBus } from './bus.js';
import { EventRouter, type HandlerContext } from './router.js';
import { buildMarketRegistrations } from './handlers/market.js';
import { buildVaultRegistrations } from './handlers/vault.js';
import { buildReferralRegistrations } from './handlers/referral.js';
import { getContract, hasContract } from '@noether/shared';
import type { DecodedMarketEvent } from './types/events.js';

/** Tables written by the event handlers — truncated before replay. */
export const PROJECTION_TABLES = [
  'positions',
  'vaults',
  'vault_deposits',
  'vault_withdraws',
  'vault_fee_claims',
  'vault_trades',
  'referrers',
  'referral_bindings',
  'referral_trades',
  'referral_claims',
];

export interface ReindexResult {
  replayed: number;
  failed: number;
}

export async function reindexProjections(
  db: Client,
  router: EventRouter,
  rpc: RpcNs.Server,
  log: Logger,
  bus: IndexerBus = new IndexerBus(),
): Promise<ReindexResult> {
  for (const table of PROJECTION_TABLES) {
    await db.execute(`DELETE FROM ${table}`);
  }

  const result = await db.execute(`
    SELECT event_id, contract_id, topic, ledger, ledger_close_ts, tx_hash, payload_json
    FROM events_raw
    ORDER BY ledger ASC, event_id ASC
  `);

  const ctx: HandlerContext = { db, rpc, bus, log, replay: true };
  let replayed = 0;
  let failed = 0;
  for (const row of result.rows) {
    const event = reviveEvent(row);
    try {
      await router.dispatch(event, ctx);
      replayed++;
    } catch (err) {
      failed++;
      log.error({ err, eventId: event.id, topic: event.topic }, 'Replay failed for event');
    }
  }
  return { replayed, failed };
}

/**
 * Reconstruct a decoded event from its archived row. payload_json
 * stores bigints as strings (see serialisePayload); the handlers
 * `.toString()` numeric fields before persisting, so string values
 * round-trip cleanly.
 */
function reviveEvent(row: Row): DecodedMarketEvent {
  const payload = JSON.parse(String(row.payload_json)) as Record<string, unknown>;
  return {
    ...payload,
    id: String(row.event_id),
    contractId: String(row.contract_id),
    topic: String(row.topic),
    ledger: Number(row.ledger),
    ledgerCloseTs: Number(row.ledger_close_ts),
    txHash: String(row.tx_hash),
  } as unknown as DecodedMarketEvent;
}

// CLI entry: `tsx src/reindex.ts`
const isDirect = import.meta.url === `file://${process.argv[1]}`;
if (isDirect) {
  const config = loadConfig();
  const log = pino({ level: config.logLevel });
  const db = createDb(config);
  try {
    await runMigrations(db);

    const router = new EventRouter();
    const market = getContract('market', config.contracts);
    for (const reg of buildMarketRegistrations(market)) {
      router.register(reg.contractId, reg.topic, reg.handler);
    }
    if (hasContract('vaultFactory', config.contracts)) {
      for (const reg of buildVaultRegistrations(getContract('vaultFactory', config.contracts))) {
        router.register(reg.contractId, reg.topic, reg.handler);
      }
    }
    if (hasContract('referral', config.contracts)) {
      for (const reg of buildReferralRegistrations(getContract('referral', config.contracts))) {
        router.register(reg.contractId, reg.topic, reg.handler);
      }
    }

    const rpc = createRpc(config.rpcUrl);
    const { replayed, failed } = await reindexProjections(db, router, rpc, log);
    log.info({ replayed, failed }, 'Reindex complete');
    if (failed > 0) process.exitCode = 1;
  } finally {
    db.close();
  }
}
