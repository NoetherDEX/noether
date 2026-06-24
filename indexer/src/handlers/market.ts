import type { Client } from '@libsql/client';
import type { DecodedMarketEvent } from '../types/events.js';
import type { Handler, HandlerContext } from '../router.js';
import { reconcileCrossPositions } from '../crossLiqSync.js';

/**
 * Phase 2 v0 market handler: persist the decoded event to events_raw and
 * emit on the bus. Phase 3+ will add projections that derive trades,
 * candles, positions, and orders from this log.
 */
function handle(
  topic: DecodedMarketEvent['topic'],
  marketContractId: string,
  networkPassphrase?: string,
): Handler {
  return async (event, ctx) => {
    // Idempotency (I-2): the events_raw insert is OR IGNORE, so rowsAffected==0
    // means we have already processed this event_id. Skip the projection mutation
    // and every bus emit to avoid double-counting / duplicate WS frames on replay.
    const inserted = await insertEvent(ctx.db, event);
    if (inserted === 0) {
      ctx.log.debug({ topic, eventId: event.id }, 'duplicate event — skipped projection + emit');
      return;
    }
    await maintainPositionsProjection(ctx.db, event);
    // cross_liq closes all the trader's cross positions but names none, so the
    // open-position projection would keep them as phantoms. Reconcile against
    // on-chain truth (best-effort; skipped when no passphrase, e.g. in tests).
    if (event.topic === 'cross_liq' && networkPassphrase) {
      await reconcileCrossPositions(
        ctx.db, ctx.rpc, marketContractId, networkPassphrase, event.trader, ctx.log,
      ).catch((err) => ctx.log.warn({ err }, 'cross_liq phantom cleanup failed'));
    }
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
        });
        break;
      case 'position_closed':
        ctx.bus.emit('position', { positionId: event.positionId, trader: event.trader, state: 'closed' });
        ctx.bus.emit('trade', {
          kind: 'close',
          positionId: event.positionId,
          trader: event.trader,
          price: event.closePrice,
          size: 0n,
          ts: event.ledgerCloseTs,
        });
        break;
      case 'position_liquidated':
        ctx.bus.emit('position', { positionId: event.positionId, trader: event.trader, state: 'liquidated' });
        ctx.bus.emit('trade', {
          kind: 'liquidation',
          positionId: event.positionId,
          trader: event.trader,
          price: event.closePrice,
          size: 0n,
          ts: event.ledgerCloseTs,
        });
        break;
      case 'position_reduced':
        // Partial close (P5-9): the position survives at the reduced size.
        ctx.bus.emit('position', { positionId: event.positionId, trader: event.trader, state: 'reduced' });
        ctx.bus.emit('trade', {
          kind: 'close',
          positionId: event.positionId,
          trader: event.trader,
          price: event.price,
          size: event.closeSize,
          ts: event.ledgerCloseTs,
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
      // initialized / cross_liq are persisted but have no projection
      default:
        break;
    }

    ctx.log.debug({ topic, eventId: event.id, ledger: event.ledger }, 'event processed');
  };
}

async function maintainPositionsProjection(db: Client, event: DecodedMarketEvent): Promise<void> {
  switch (event.topic) {
    case 'position_opened':
      await db.execute({
        sql: `
          INSERT OR REPLACE INTO positions
            (position_id, trader, asset, direction, size, entry_price, opened_at, opened_tx_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
    case 'position_reduced':
      // Partial close (P5-9): keep the row, update its size to the residual.
      await db.execute({
        sql: 'UPDATE positions SET size = ? WHERE position_id = ?',
        args: [event.newSize.toString(), event.positionId],
      });
      return;
    default:
      return;
  }
}

/** Returns rowsAffected: 1 on a fresh insert, 0 when the event_id already exists. */
async function insertEvent(db: Client, event: DecodedMarketEvent): Promise<number> {
  const payload = serialisePayload(event);
  const result = await db.execute({
    sql: `
      INSERT OR IGNORE INTO events_raw (
        event_id, contract_id, topic, ledger, ledger_close_ts, tx_hash, payload_json, inserted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      event.id,
      event.contractId,
      event.topic,
      event.ledger,
      event.ledgerCloseTs,
      event.txHash,
      payload,
      Date.now(),
    ],
  });
  return result.rowsAffected;
}

function serialisePayload(event: DecodedMarketEvent): string {
  const { id: _id, contractId: _c, ledger: _l, ledgerCloseTs: _lct, txHash: _t, ...rest } = event;
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
  'position_reduced',
  'cross_liq',
  'order_placed',
  'order_cancelled',
  'order_executed',
  'funding_applied',
];

export function buildMarketRegistrations(
  marketContractId: string,
  networkPassphrase?: string,
): MarketHandlerRegistration[] {
  return MARKET_TOPICS.map((topic) => ({
    contractId: marketContractId,
    topic,
    handler: handle(topic, marketContractId, networkPassphrase),
  }));
}

export const __testables = { insertEvent, serialisePayload };
export type { HandlerContext };
