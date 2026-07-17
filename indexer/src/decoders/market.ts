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
  AdlExecutedEvent,
  AdlFlagEvent,
  BadDebtRecordedEvent,
  CrossLiquidatedEvent,
  FundingAppliedEvent,
  InitializedEvent,
  LiqRefundEvent,
  OrderCancelledEvent,
  OrderExecutedEvent,
  OrderPlacedEvent,
  PositionClosedEvent,
  PositionLiquidatedEvent,
  PositionOpenedEvent,
  PositionPartialLiqEvent,
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
    case 'position_partial_liq':
      return decodePositionPartialLiq(raw, value);
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
    case 'liq_refund':
      return decodeLiqRefund(raw, value);
    case 'bad_debt_recorded':
      return decodeBadDebtRecorded(raw, value);
    case 'adl_executed':
      return decodeAdlExecuted(raw, value);
    case 'adl_triggered':
    case 'adl_cleared':
      return decodeAdlFlag(raw, value, topic);
    default:
      return null;
  }
}

// Market contract emits these tuples (see contracts/market/src/lib.rs):
//   position_opened     : (id, trader, asset, direction, size, entry_price)
//   position_closed     : (id, trader, asset, direction, size, entry_price, current_price, pnl)
//   position_liquidated : (id, trader, asset, direction, size, keeper_reward, current_price)
// asset/direction/size were originally skipped as "analytics only" on
// closes; they're now decoded on all three so the positions projection
// renders without an on-chain hop and close-side volume is derivable
// from the archive (I-6 — fixes the api's `trades.UNKNOWN` fan-out).

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
    asset: asString(v[2], 'position_closed.asset'),
    direction: asNumber(v[3], 'position_closed.direction'),
    size: asBigInt(v[4], 'position_closed.size'),
    entryPrice: asBigInt(v[5], 'position_closed.entry_price'),
    closePrice: asBigInt(v[6], 'position_closed.close_price'),
    pnl: asBigInt(v[7], 'position_closed.pnl'),
  };
}

function decodePositionLiquidated(raw: RawEvent, v: unknown[]): PositionLiquidatedEvent {
  return {
    ...envelope(raw, 'position_liquidated'),
    topic: 'position_liquidated',
    positionId: asNumber(v[0], 'position_liquidated.position_id'),
    trader: asString(v[1], 'position_liquidated.trader'),
    asset: asString(v[2], 'position_liquidated.asset'),
    direction: asNumber(v[3], 'position_liquidated.direction'),
    size: asBigInt(v[4], 'position_liquidated.size'),
    keeperReward: asBigInt(v[5], 'position_liquidated.keeper_reward'),
    closePrice: asBigInt(v[6], 'position_liquidated.close_price'),
  };
}

// position_partial_liq: (id, trader, asset, direction, closed_size,
// keeper_reward, current_price) — same tuple shape as position_liquidated,
// but the position SURVIVES with reduced size (T3-D4).
function decodePositionPartialLiq(raw: RawEvent, v: unknown[]): PositionPartialLiqEvent {
  return {
    ...envelope(raw, 'position_partial_liq'),
    topic: 'position_partial_liq',
    positionId: asNumber(v[0], 'position_partial_liq.position_id'),
    trader: asString(v[1], 'position_partial_liq.trader'),
    asset: asString(v[2], 'position_partial_liq.asset'),
    direction: asNumber(v[3], 'position_partial_liq.direction'),
    size: asBigInt(v[4], 'position_partial_liq.closed_size'),
    keeperReward: asBigInt(v[5], 'position_partial_liq.keeper_reward'),
    closePrice: asBigInt(v[6], 'position_partial_liq.close_price'),
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

// liq_refund: (trader, position_id [0 = cross account-level], refund, penalty) — L0-4
function decodeLiqRefund(raw: RawEvent, v: unknown[]): LiqRefundEvent {
  return {
    ...envelope(raw, 'liq_refund'),
    topic: 'liq_refund',
    trader: asString(v[0], 'liq_refund.trader'),
    positionId: asNumber(v[1], 'liq_refund.position_id'),
    refund: asBigInt(v[2], 'liq_refund.refund'),
    penalty: asBigInt(v[3], 'liq_refund.penalty'),
  };
}

// bad_debt_recorded: (trader, asset, amount, buffer_covered, lp_absorbed) — L0-2
function decodeBadDebtRecorded(raw: RawEvent, v: unknown[]): BadDebtRecordedEvent {
  return {
    ...envelope(raw, 'bad_debt_recorded'),
    topic: 'bad_debt_recorded',
    trader: asString(v[0], 'bad_debt_recorded.trader'),
    asset: asString(v[1], 'bad_debt_recorded.asset'),
    amount: asBigInt(v[2], 'bad_debt_recorded.amount'),
    bufferCovered: asBigInt(v[3], 'bad_debt_recorded.buffer_covered'),
    lpAbsorbed: asBigInt(v[4], 'bad_debt_recorded.lp_absorbed'),
  };
}

// adl_executed: (position_id, trader, asset, direction, size, price, pnl, score) — L0-1
function decodeAdlExecuted(raw: RawEvent, v: unknown[]): AdlExecutedEvent {
  return {
    ...envelope(raw, 'adl_executed'),
    topic: 'adl_executed',
    positionId: asNumber(v[0], 'adl_executed.position_id'),
    trader: asString(v[1], 'adl_executed.trader'),
    asset: asString(v[2], 'adl_executed.asset'),
    direction: asNumber(v[3], 'adl_executed.direction'),
    size: asBigInt(v[4], 'adl_executed.size'),
    price: asBigInt(v[5], 'adl_executed.price'),
    pnl: asBigInt(v[6], 'adl_executed.pnl'),
    score: asBigInt(v[7], 'adl_executed.score'),
  };
}

// adl_triggered / adl_cleared: (asset, reason, payable_upnl, coverage) — L0-1
function decodeAdlFlag(
  raw: RawEvent,
  v: unknown[],
  topic: 'adl_triggered' | 'adl_cleared',
): AdlFlagEvent {
  return {
    ...envelope(raw, topic),
    topic,
    asset: asString(v[0], `${topic}.asset`),
    reason: asNumber(v[1], `${topic}.reason`),
    payableUpnl: asBigInt(v[2], `${topic}.payable_upnl`),
    coverage: asBigInt(v[3], `${topic}.coverage`),
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
