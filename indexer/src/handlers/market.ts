import type { Db, DbTransaction } from '@noether/db';
import type { DecodedMarketEvent } from '../types/events.js';
import type { Handler, HandlerContext } from '../router.js';
import { cleanupCrossLiquidatedPositions } from '../positionSync.js';

type DbConn = Db | DbTransaction;

/**
 * Market handler: persist the decoded event to events_raw, maintain the
 * positions projection, and emit on the bus. All deterministic writes
 * for one event run inside a single libsql transaction so a mid-event
 * crash can never half-apply (I-2); RPC-driven enrichment (cross_liq
 * verification) runs after commit.
 */
function handle(topic: DecodedMarketEvent['topic']): Handler {
  return async (event, ctx) => {
    const tx = await ctx.db.transaction('write');
    try {
      const inserted = await insertEvent(tx, event);
      if (!inserted && !ctx.replay) {
        await rollbackQuietly(tx);
        ctx.log.debug({ topic, eventId: event.id }, 'Duplicate event — projection and bus emit skipped');
        return;
      }
      await maintainPositionsProjection(tx, event);
      await recordRealizedTrade(tx, event);
      await tx.commit();
    } catch (err) {
      await rollbackQuietly(tx);
      // Keep the archive row so the retry pass hits the idempotency
      // guard and the cursor can advance past the dead-lettered event
      // without re-applying anything.
      await insertEvent(ctx.db, event).catch(() => {});
      throw err;
    }

    if (event.topic === 'cross_liq') {
      // liquidate_cross_account wipes ALL of the trader's cross positions
      // on-chain but emits a single cross_liq event with no position ids,
      // and the projection stores no margin mode — verify each of the
      // trader's projected rows via get_position and drop the dead ones.
      // RPC-driven, so it runs outside the write transaction.
      const passphrase = process.env.NETWORK_PASSPHRASE
        ?? 'Test SDF Network ; September 2015';
      await cleanupCrossLiquidatedPositions(
        ctx.db, ctx.rpc, event.contractId, event.trader, passphrase, ctx.log,
      );
    }

    if (!ctx.replay) emitBus(ctx, event);
    ctx.log.debug({ topic, eventId: event.id, ledger: event.ledger }, 'event processed');
  };
}

function emitBus(ctx: HandlerContext, event: DecodedMarketEvent): void {
  ctx.bus.emit('event', event);
  switch (event.topic) {
    case 'position_opened':
      ctx.bus.emit('position', { positionId: event.positionId, trader: event.trader, state: 'opened' });
      ctx.bus.emit('trade', {
        kind: 'open',
        positionId: event.positionId,
        trader: event.trader,
        price: event.entryPrice,
        size: event.size,
        ts: event.ledgerCloseTs,
        asset: event.asset,
      });
      break;
    case 'position_closed':
      ctx.bus.emit('position', { positionId: event.positionId, trader: event.trader, state: 'closed' });
      ctx.bus.emit('trade', {
        kind: 'close',
        positionId: event.positionId,
        trader: event.trader,
        price: event.closePrice,
        size: event.size,
        ts: event.ledgerCloseTs,
        asset: event.asset,
      });
      break;
    case 'position_liquidated':
      ctx.bus.emit('position', { positionId: event.positionId, trader: event.trader, state: 'liquidated' });
      ctx.bus.emit('trade', {
        kind: 'liquidation',
        positionId: event.positionId,
        trader: event.trader,
        price: event.closePrice,
        size: event.size,
        ts: event.ledgerCloseTs,
        asset: event.asset,
      });
      break;
    case 'position_partial_liq':
      // The position SURVIVES (T3-D4) — no position-removal fan-out; the
      // closed tranche is still a liquidation fill for trade consumers.
      ctx.bus.emit('trade', {
        kind: 'liquidation',
        positionId: event.positionId,
        trader: event.trader,
        price: event.closePrice,
        size: event.size,
        ts: event.ledgerCloseTs,
        asset: event.asset,
      });
      break;
    case 'order_placed':
      ctx.bus.emit('order', { orderId: event.orderId, state: 'placed' });
      break;
    case 'order_cancelled':
      ctx.bus.emit('order', { orderId: event.orderId, state: 'cancelled' });
      break;
    case 'order_executed':
      ctx.bus.emit('order', { orderId: event.orderId, state: 'executed' });
      break;
    case 'funding_applied':
      ctx.bus.emit('funding', {
        fundingRate: event.fundingRate,
        hoursElapsed: event.hoursElapsed,
        ts: event.ledgerCloseTs,
      });
      break;
    // initialized / cross_liq are persisted but have no bus fan-out
    default:
      break;
  }
}

async function rollbackQuietly(tx: DbTransaction): Promise<void> {
  try {
    await tx.rollback();
  } catch {
    /* transaction already closed */
  }
}

async function maintainPositionsProjection(db: DbConn, event: DecodedMarketEvent): Promise<void> {
  switch (event.topic) {
    case 'position_opened':
      await db.execute({
        sql: `
          INSERT INTO positions
            (position_id, trader, asset, direction, size, entry_price, opened_at, opened_tx_hash, contract_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (position_id) DO UPDATE SET
            trader = EXCLUDED.trader,
            asset = EXCLUDED.asset,
            direction = EXCLUDED.direction,
            size = EXCLUDED.size,
            entry_price = EXCLUDED.entry_price,
            opened_at = EXCLUDED.opened_at,
            opened_tx_hash = EXCLUDED.opened_tx_hash,
            contract_id = EXCLUDED.contract_id
        `,
        args: [
          event.positionId,
          event.trader,
          event.asset,
          Number(event.direction),
          event.size.toString(),
          event.entryPrice.toString(),
          event.ledgerCloseTs,
          event.txHash,
          event.contractId,
        ],
      });
      return;
    case 'position_closed':
    case 'position_liquidated':
      await db.execute({
        sql: 'DELETE FROM positions WHERE position_id = ?',
        args: [event.positionId],
      });
      return;
    case 'position_partial_liq':
      // Shrink the surviving position by the closed tranche. size stays
      // TEXT for read parity; do the arithmetic through numeric casts.
      await db.execute({
        sql: `
          UPDATE positions
          SET size = ((size)::numeric - (?)::numeric)::text
          WHERE position_id = ?
        `,
        args: [event.size.toString(), event.positionId],
      });
      return;
    default:
      return;
  }
}

/**
 * Realized-trade projection (I-8): one row per close / liquidation into
 * the `trades` table (migration 017). position_closed carries entry_price
 * and pnl; position_liquidated carries neither, so both stay NULL for
 * liquidation rows. Keyed on the Soroban event_id via ON CONFLICT DO NOTHING so
 * a live redelivery or a `reindex` replay writes exactly once.
 */
async function recordRealizedTrade(db: DbConn, event: DecodedMarketEvent): Promise<void> {
  if (
    event.topic !== 'position_closed' &&
    event.topic !== 'position_liquidated' &&
    event.topic !== 'position_partial_liq'
  ) {
    return;
  }
  const isClose = event.topic === 'position_closed';
  await db.execute({
    sql: `
      INSERT INTO trades (
        event_id, position_id, trader, asset, direction, kind, size,
        entry_price, close_price, pnl, ledger, ts, tx_hash, contract_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (event_id) DO NOTHING
    `,
    args: [
      event.id,
      event.positionId,
      event.trader,
      event.asset,
      Number(event.direction),
      isClose ? 'close' : 'liquidation',
      event.size.toString(),
      isClose ? event.entryPrice.toString() : null,
      event.closePrice.toString(),
      isClose ? event.pnl.toString() : null,
      event.ledger,
      event.ledgerCloseTs,
      event.txHash,
      event.contractId,
    ],
  });
}

async function insertEvent(db: DbConn, event: DecodedMarketEvent): Promise<boolean> {
  const payload = serialisePayload(event);
  const result = await db.execute({
    sql: `
      INSERT INTO events_raw (
        event_id, contract_id, topic, ledger, ledger_close_ts, tx_hash, payload_json, topic_xdr, value_xdr, inserted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (event_id) DO NOTHING
    `,
    args: [
      event.id,
      event.contractId,
      event.topic,
      event.ledger,
      event.ledgerCloseTs,
      event.txHash,
      payload,
      event.topicXdr ? JSON.stringify(event.topicXdr) : null,
      event.valueXdr ?? null,
      Date.now(),
    ],
  });
  return result.rowsAffected > 0;
}

function serialisePayload(event: DecodedMarketEvent): string {
  const {
    id: _id, contractId: _c, ledger: _l, ledgerCloseTs: _lct, txHash: _t,
    topicXdr: _tx, valueXdr: _vx, ...rest
  } = event;
  return JSON.stringify(rest, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

export interface MarketHandlerRegistration {
  contractId: string;
  topic: DecodedMarketEvent['topic'];
  handler: Handler;
}

const MARKET_TOPICS: DecodedMarketEvent['topic'][] = [
  'initialized',
  'position_opened',
  'position_closed',
  'position_liquidated',
  'position_partial_liq',
  'cross_liq',
  'order_placed',
  'order_cancelled',
  'order_executed',
  'funding_applied',
];

export function buildMarketRegistrations(marketContractId: string): MarketHandlerRegistration[] {
  return MARKET_TOPICS.map((topic) => ({
    contractId: marketContractId,
    topic,
    handler: handle(topic),
  }));
}

export const __testables = { insertEvent, serialisePayload };
export type { HandlerContext };
