import type { StellarAddress } from './common.js';

export type Direction = 'Long' | 'Short';

export type MarginMode = 'Isolated' | 'Cross';

export type OrderType =
  | 'LimitEntry'
  | 'StopLoss'
  | 'TakeProfit'
  | 'StopLimit'
  | 'TrailingStop';

export type OrderStatus =
  | 'Pending'
  | 'Executed'
  | 'Cancelled'
  | 'CancelledSlippage'
  | 'Expired';

export type TriggerCondition = 'Above' | 'Below';

export interface Position {
  id: number;
  trader: StellarAddress;
  asset: string;
  direction: Direction;
  collateral: bigint;
  size: bigint;
  entryPrice: bigint;
  liquidationPrice: bigint;
  openedAt: number;
  lastFundingAt: number;
  accumulatedFunding: bigint;
  marginMode: MarginMode;
}

export interface Order {
  id: number;
  trader: StellarAddress;
  asset: string;
  orderType: OrderType;
  direction: Direction;
  collateral: bigint;
  leverage: number;
  triggerPrice: bigint;
  triggerCondition: TriggerCondition;
  slippageToleranceBps: number;
  positionId: number;
  hasPosition: boolean;
  createdAt: number;
  status: OrderStatus;
  limitPrice: bigint;
  trailingPercentBps: number;
  timeInForce: number;
  stopLimitPhase: number;
}

export interface MarketConfig {
  minCollateral: bigint;
  maxLeverage: number;
  maintenanceMarginBps: number;
  liquidationFeeBps: number;
  tradingFeeBps: number;
  baseFundingRateBps: number;
  maxPositionSize: bigint;
  maxPriceStaleness: number;
  maxOracleDeviationBps: number;
  baseMakerFeeBps: number;
  baseTakerFeeBps: number;
}

export interface TraderFeeInfo {
  volume14d: bigint;
  tier: number;
  makerFeeBps: number;
  takerFeeBps: number;
  nextTierVolume: bigint;
}

export interface PoolInfo {
  totalUsdc: bigint;
  totalNoe: bigint;
  unrealizedPnl: bigint;
  totalFees: bigint;
  noePrice: bigint;
}

// Mirrors the gateway /v1/trades kind enum. 'adl' is a forced realization
// at the oracle mark (L0-1); 'cross_liquidation' is an account-level row.
export type TradeKind = 'open' | 'close' | 'liquidation' | 'cross_liquidation' | 'adl';

export interface Trade {
  id: string;
  txHash: string;
  trader: StellarAddress;
  asset: string;
  direction: Direction;
  kind: TradeKind;
  size: bigint;
  price: bigint;
  entryPrice?: bigint;
  pnl?: bigint;
  fee: bigint;
  ledger: number;
  timestamp: number;
}

export type CandleInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export interface Candle {
  asset: string;
  interval: CandleInterval;
  bucketTs: number;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  volume: bigint;
}
