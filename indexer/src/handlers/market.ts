import type { Client } from '@libsql/client';
import type { DecodedMarketEvent } from '../types/events.js';
import type { Handler, HandlerContext } from '../router.js';

/**
 * Phase 2 v0 market handler: persist the decoded event to events_raw and
 * emit on the bus. Phase 3+ will add projections that derive trades,
 * candles, positions, and orders from this log.
 */
function handle(topic: DecodedMarketEvent['topic']): Handler {
  return async (event, ctx) => {
    await insertEvent(ctx.db, event);
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

async function insertEvent(db: Client, event: DecodedMarketEvent): Promise<void> {
  const payload = serialisePayload(event);
  await db.execute({
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
