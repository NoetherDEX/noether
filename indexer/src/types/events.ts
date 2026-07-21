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
  /** L0-13: per-asset funding. undefined on the legacy 2-tuple event. */
  asset?: string;
  fundingRate: bigint;
  hoursElapsed: bigint;
  /** L0-13: per-asset cumulative funding index. undefined on the legacy event. */
  cumulativeIndex?: bigint;
}

/** L0-6: a partial CLOSE (trader-initiated); the position SURVIVES, shrunk. */
export interface PositionReducedEvent extends EventEnvelope {
  topic: 'position_reduced';
  positionId: number;
  trader: StellarAddress;
  asset: string;
  closedSize: bigint;
  remainingSize: bigint;
  closePrice: bigint;
  pnl: bigint;
}

export interface InitializedEvent extends EventEnvelope {
  topic: 'initialized';
  admin: StellarAddress;
  vault: StellarAddress;
  oracleAdapter: StellarAddress;
}

/** L0-4: non-bankrupt liquidation refunded the residual above the penalty.
 * positionId 0 = cross account-level (the whole-account close-out). */
export interface LiqRefundEvent extends EventEnvelope {
  topic: 'liq_refund';
  trader: StellarAddress;
  positionId: number;
  refund: bigint;
  penalty: bigint;
}

/** L0-2: a bankrupt settle booked uncollectable loss — buffer covered what
 * it could, the remainder fell to LP NAV. asset 'CROSS' = account-level. */
export interface BadDebtRecordedEvent extends EventEnvelope {
  topic: 'bad_debt_recorded';
  trader: StellarAddress;
  asset: string;
  amount: bigint;
  bufferCovered: bigint;
  lpAbsorbed: bigint;
}

/** L0-1: a winner was force-realized at mark while ADL was active. */
export interface AdlExecutedEvent extends EventEnvelope {
  topic: 'adl_executed';
  positionId: number;
  trader: StellarAddress;
  asset: string;
  direction: number;
  size: bigint;
  price: bigint;
  pnl: bigint;
  score: bigint;
}

/** L0-1: the per-asset ADL flag flipped (reason 0 = coverage ratio,
 * 1 = shortfall auto-flip; payable/coverage are 0 on the shortfall path). */
export interface AdlFlagEvent extends EventEnvelope {
  topic: 'adl_triggered' | 'adl_cleared';
  asset: string;
  reason: number;
  payableUpnl: bigint;
  coverage: bigint;
}

/** L0-15: the market's pause mode changed (0 live / 1 halt-open / 2 full-freeze). */
export interface PausedEvent extends EventEnvelope {
  topic: 'paused';
  mode: number;
  since: number;
}

/** L0-15: a full-freeze auto-degraded to halt-open after the 72h ceiling. */
export interface PauseDegradedEvent extends EventEnvelope {
  topic: 'pause_degraded';
  fromMode: number;
  toMode: number;
}

/** L1-24: per-asset trading halt flipped (risk-increasing paths only). */
export interface AssetHaltSetEvent extends EventEnvelope {
  topic: 'asset_halt_set';
  asset: string;
  halted: boolean;
}

/** L0-6: collateral added to / removed from an isolated position. */
export interface CollateralChangedEvent extends EventEnvelope {
  topic: 'collateral_added' | 'collateral_removed';
  positionId: number;
  trader: string;
  amount: bigint;
  liquidationPrice: bigint;
}

export type DecodedMarketEvent =
  | PositionOpenedEvent
  | PositionClosedEvent
  | PositionLiquidatedEvent
  | PositionPartialLiqEvent
  | PositionReducedEvent
  | CrossLiquidatedEvent
  | OrderPlacedEvent
  | OrderCancelledEvent
  | OrderExecutedEvent
  | FundingAppliedEvent
  | InitializedEvent
  | LiqRefundEvent
  | BadDebtRecordedEvent
  | AdlExecutedEvent
  | AdlFlagEvent
  | PausedEvent
  | PauseDegradedEvent
  | AssetHaltSetEvent
  | CollateralChangedEvent;

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
