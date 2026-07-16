/**
 * Internal event types after decoding ScVal payloads.
 *
 * These are the typed shapes emitted by decoders, consumed by handlers,
 * and forwarded to the in-process bus. Payload field naming mirrors what
 * the contracts emit (see contracts/market/src/lib.rs `events().publish`).
 */

import type { Direction, MarginMode, OrderStatus, OrderType, StellarAddress } from '@noether/types';

export interface EventEnvelope {
  /** Soroban event id (unique, used as deduplication key). */
  id: string;
  /** Stellar contract address that emitted the event. */
  contractId: StellarAddress;
  /** Top-level topic name (e.g. "position_opened"). */
  topic: string;
  /** Ledger sequence in which the event landed. */
  ledger: number;
  /** Approximate ledger close time (unix seconds). */
  ledgerCloseTs: number;
  /** Containing transaction hash. */
  txHash: string;
  /** Raw topic ScVals (base64 XDR), captured before decoding (I-6). */
  topicXdr?: string[];
  /** Raw value ScVal (base64 XDR), captured before decoding (I-6). */
  valueXdr?: string;
}

export interface PositionOpenedEvent extends EventEnvelope {
  topic: 'position_opened';
  positionId: number;
  trader: StellarAddress;
  asset: string;
  direction: number;
  size: bigint;
  entryPrice: bigint;
}

export interface PositionClosedEvent extends EventEnvelope {
  topic: 'position_closed';
  positionId: number;
  trader: StellarAddress;
  asset: string;
  direction: number;
  size: bigint;
  entryPrice: bigint;
  pnl: bigint;
  closePrice: bigint;
}

export interface PositionLiquidatedEvent extends EventEnvelope {
  topic: 'position_liquidated';
  positionId: number;
  trader: StellarAddress;
  asset: string;
  direction: number;
  size: bigint;
  keeperReward: bigint;
  closePrice: bigint;
}

/** T3-D4: a partial liquidation closed a tranche; the position SURVIVES. */
export interface PositionPartialLiqEvent extends EventEnvelope {
  topic: 'position_partial_liq';
  positionId: number;
  trader: StellarAddress;
  asset: string;
  direction: number;
  /** Size of the CLOSED tranche (not the whole position). */
  size: bigint;
  keeperReward: bigint;
  closePrice: bigint;
}

export interface CrossLiquidatedEvent extends EventEnvelope {
  topic: 'cross_liq';
  trader: StellarAddress;
  totalPnl: bigint;
  keeperReward: bigint;
}

export interface OrderPlacedEvent extends EventEnvelope {
  topic: 'order_placed';
  orderId: number;
  trader: StellarAddress;
  triggerPrice: bigint;
}

export interface OrderCancelledEvent extends EventEnvelope {
  topic: 'order_cancelled';
  orderId: number;
  reason: 'user' | 'slippage' | string;
}

export interface OrderExecutedEvent extends EventEnvelope {
  topic: 'order_executed';
  orderId: number;
  keeperReward: bigint;
}

export interface FundingAppliedEvent extends EventEnvelope {
  topic: 'funding_applied';
  fundingRate: bigint;
  hoursElapsed: bigint;
}

export interface InitializedEvent extends EventEnvelope {
  topic: 'initialized';
  admin: StellarAddress;
  vault: StellarAddress;
  oracleAdapter: StellarAddress;
}

export type DecodedMarketEvent =
  | PositionOpenedEvent
  | PositionClosedEvent
  | PositionLiquidatedEvent
  | PositionPartialLiqEvent
  | CrossLiquidatedEvent
  | OrderPlacedEvent
  | OrderCancelledEvent
  | OrderExecutedEvent
  | FundingAppliedEvent
  | InitializedEvent;

/** Position state fetched lazily from the contract for enrichment. */
export interface ContractPosition {
  id: number;
  trader: StellarAddress;
  asset: string;
  direction: Direction;
  collateral: bigint;
  size: bigint;
  entryPrice: bigint;
  liquidationPrice: bigint;
  openedAt: number;
  marginMode: MarginMode;
}

/** Order state fetched lazily from the contract for enrichment. */
export interface ContractOrder {
  id: number;
  trader: StellarAddress;
  asset: string;
  orderType: OrderType;
  direction: Direction;
  collateral: bigint;
  leverage: number;
  triggerPrice: bigint;
  limitPrice: bigint;
  trailingPercentBps: number;
  timeInForce: number;
  stopLimitPhase: number;
  status: OrderStatus;
  createdAt: number;
}
