/**
 * Decoders for market contract events.
 *
 * Each event topic in contracts/market/src/lib.rs has a fixed positional
 * payload. The decoders below map raw ScVal payloads to typed event
 * objects defined in ../types/events.ts.
 */

import type { rpc, xdr } from '@stellar/stellar-sdk';
import type {
  DecodedMarketEvent,
  EventEnvelope,
  CrossLiquidatedEvent,
  FundingAppliedEvent,
  InitializedEvent,
  OrderCancelledEvent,
  OrderExecutedEvent,
  OrderPlacedEvent,
  PositionClosedEvent,
  PositionLiquidatedEvent,
  PositionOpenedEvent,
} from '../types/events.js';
import { decodeEventValue, decodeTopics, asBigInt, asNumber, asString } from './scval.js';

export type RawEvent = rpc.Api.EventResponse;

function envelope(raw: RawEvent, topic: string): EventEnvelope {
  return {
    id: raw.id,
    contractId: raw.contractId?.toString() ?? '',
    topic,
    ledger: raw.ledger,
    ledgerCloseTs: Math.floor(new Date(raw.ledgerClosedAt).getTime() / 1000),
    txHash: raw.txHash,
  };
}

/**
 * Top-level decode entry. Returns null for events whose topic we don't
 * recognise yet (forward-compatible: new contracts can emit topics the
 * indexer hasn't been taught about without crashing the loop).
 */
export function decodeMarketEvent(raw: RawEvent): DecodedMarketEvent | null {
  const topics = decodeTopics(raw.topic as xdr.ScVal[]);
  const topic = topics[0];
  if (typeof topic !== 'string') return null;

  const value = decodeEventValue(raw.value as unknown as xdr.ScVal);

  switch (topic) {
    case 'position_opened':
      return decodePositionOpened(raw, value);
    case 'position_closed':
      return decodePositionClosed(raw, value);
    case 'position_liquidated':
      return decodePositionLiquidated(raw, value);
    case 'cross_liq':
      return decodeCrossLiq(raw, value);
    case 'order_placed':
      return decodeOrderPlaced(raw, value);
    case 'order_cancelled':
      return decodeOrderCancelled(raw, value);
    case 'order_executed':
      return decodeOrderExecuted(raw, value);
    case 'funding_applied':
      return decodeFundingApplied(raw, value);
    case 'initialized':
      return decodeInitialized(raw, value);
    default:
      return null;
  }
}

// Market contract emits these tuples (see contracts/market/src/lib.rs):
//   position_opened     : (id, trader, asset, direction, size, entry_price)
//   position_closed     : (id, trader, asset, direction, size, entry_price, current_price, pnl)
//   position_liquidated : (id, trader, asset, direction, size, keeper_reward, current_price)
// asset/direction were originally skipped as "analytics only"; they're
// now needed by the positions projection so the leader-mode positions
// tab can render without a second on-chain hop.

function decodePositionOpened(raw: RawEvent, v: unknown[]): PositionOpenedEvent {
  return {
    ...envelope(raw, 'position_opened'),
    topic: 'position_opened',
    positionId: asNumber(v[0], 'position_opened.position_id'),
    trader: asString(v[1], 'position_opened.trader'),
    asset: asString(v[2], 'position_opened.asset'),
    direction: asNumber(v[3], 'position_opened.direction'),
    size: asBigInt(v[4], 'position_opened.size'),
    entryPrice: asBigInt(v[5], 'position_opened.entry_price'),
  };
}

function decodePositionClosed(raw: RawEvent, v: unknown[]): PositionClosedEvent {
  return {
    ...envelope(raw, 'position_closed'),
    topic: 'position_closed',
    positionId: asNumber(v[0], 'position_closed.position_id'),
    trader: asString(v[1], 'position_closed.trader'),
    pnl: asBigInt(v[7], 'position_closed.pnl'),
    closePrice: asBigInt(v[6], 'position_closed.close_price'),
  };
}

function decodePositionLiquidated(raw: RawEvent, v: unknown[]): PositionLiquidatedEvent {
  return {
    ...envelope(raw, 'position_liquidated'),
    topic: 'position_liquidated',
    positionId: asNumber(v[0], 'position_liquidated.position_id'),
    trader: asString(v[1], 'position_liquidated.trader'),
    keeperReward: asBigInt(v[5], 'position_liquidated.keeper_reward'),
    closePrice: asBigInt(v[6], 'position_liquidated.close_price'),
  };
}

function decodeCrossLiq(raw: RawEvent, v: unknown[]): CrossLiquidatedEvent {
  // Contract emits 3-tuple: (trader, total_pnl, keeper_reward)
  return {
    ...envelope(raw, 'cross_liq'),
    topic: 'cross_liq',
    trader: asString(v[0], 'cross_liq.trader'),
    totalPnl: asBigInt(v[1], 'cross_liq.total_pnl'),
    keeperReward: asBigInt(v[2], 'cross_liq.keeper_reward'),
  };
}

function decodeOrderPlaced(raw: RawEvent, v: unknown[]): OrderPlacedEvent {
  return {
    ...envelope(raw, 'order_placed'),
    topic: 'order_placed',
    orderId: asNumber(v[0], 'order_placed.order_id'),
    trader: asString(v[1], 'order_placed.trader'),
    triggerPrice: asBigInt(v[2], 'order_placed.trigger_price'),
  };
}

function decodeOrderCancelled(raw: RawEvent, v: unknown[]): OrderCancelledEvent {
  const reasonRaw = v[1];
  const reason = typeof reasonRaw === 'string' ? reasonRaw : 'unknown';
  return {
    ...envelope(raw, 'order_cancelled'),
    topic: 'order_cancelled',
    orderId: asNumber(v[0], 'order_cancelled.order_id'),
    reason,
  };
}

function decodeOrderExecuted(raw: RawEvent, v: unknown[]): OrderExecutedEvent {
  return {
    ...envelope(raw, 'order_executed'),
    topic: 'order_executed',
    orderId: asNumber(v[0], 'order_executed.order_id'),
    keeperReward: asBigInt(v[1], 'order_executed.keeper_reward'),
  };
}

function decodeFundingApplied(raw: RawEvent, v: unknown[]): FundingAppliedEvent {
  return {
    ...envelope(raw, 'funding_applied'),
    topic: 'funding_applied',
    fundingRate: asBigInt(v[0], 'funding_applied.funding_rate'),
    hoursElapsed: asBigInt(v[1], 'funding_applied.hours_elapsed'),
  };
}

function decodeInitialized(raw: RawEvent, v: unknown[]): InitializedEvent {
  return {
    ...envelope(raw, 'initialized'),
    topic: 'initialized',
    admin: asString(v[0], 'initialized.admin'),
    vault: asString(v[1], 'initialized.vault'),
    oracleAdapter: asString(v[2], 'initialized.oracle_adapter'),
  };
}
