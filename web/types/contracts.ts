// Position direction
export type Direction = 'Long' | 'Short';

// Order type
export type OrderType = 'LimitEntry' | 'StopLoss' | 'TakeProfit' | 'StopLimit' | 'TrailingStop';

// Margin mode
export type MarginMode = 'Isolated' | 'Cross';

// Order status
export type OrderStatus = 'Pending' | 'Executed' | 'Cancelled' | 'CancelledSlippage' | 'Expired';

// Trigger condition
export type TriggerCondition = 'Above' | 'Below';

// Trading position from the market contract
export interface Position {
  id: number;
  trader: string;
  asset: string;
  direction: Direction;
  collateral: bigint;
  size: bigint;
  entryPrice: bigint;
  liquidationPrice: bigint;
  openedAt: number;
  /** Global cumulative funding index snapshot at open (PRECISION-scaled).
   *  Pending funding = size × (currentCumulative − this) / PRECISION. */
  entryCumulativeFunding: bigint;
  marginMode: MarginMode;
}

// Order from market contract
export interface Order {
  id: number;
  trader: string;
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

// Display-friendly order
export interface DisplayOrder {
  id: number;
  trader: string;
  asset: string;
  orderType: OrderType;
  direction: Direction;
  collateral: number;
  leverage: number;
  triggerPrice: number;
  triggerCondition: TriggerCondition;
  slippageToleranceBps: number;
  positionId: number;
  hasPosition: boolean;
  createdAt: Date;
  status: OrderStatus;
  // Advanced order fields
  limitPrice: number;
  trailingPercentBps: number;
  stopLimitPhase: number;
  timeInForce: 'GTC' | 'IOC' | 'PostOnly';
  reduceOnly: boolean;
  // Calculated fields
  positionSize: number;
}

// Market configuration
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

// Trader fee info
export interface TraderFeeInfo {
  volume14d: bigint;
  tier: number;
  makerFeeBps: number;
  takerFeeBps: number;
  nextTierVolume: bigint;
}

// Pool/Vault information
export interface PoolInfo {
  totalUsdc: bigint;
  totalNoe: bigint;
  unrealizedPnl: bigint;
  totalFees: bigint;
  noePrice: bigint;
}

// Price data from oracle
export interface PriceData {
  price: bigint;
  timestamp: number;
}

// Display-friendly position (converted from contract types)
export interface DisplayPosition {
  id: number;
  trader: string;
  asset: string;
  direction: Direction;
  collateral: number;
  size: number;
  entryPrice: number;
  liquidationPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  leverage: number;
  openedAt: Date;
  marginMode: MarginMode;
  /** Est. accrued funding in USDC — POSITIVE = the position pays this on
   *  close, negative = it receives. null = unknown (cumulative index not
   *  loaded) — render '—', never 0 (B4). */
  pendingFunding: number | null;
}

// Trade for history
export interface Trade {
  id: string;
  txHash: string;
  trader: string;
  asset: string;
  direction: Direction;
  type: 'open' | 'close' | 'liquidation';
  size: number;
  price: number; // Exit price for close trades
  entryPrice?: number; // Entry price (for close trades)
  pnl?: number;
  pnlPercent?: number; // PnL as percentage of size
  fee?: number | null; // deployed position_closed event carries no fee field — unknown renders '—'
  timestamp: Date;
}

// PnL share card data
export interface PnlShareData {
  asset: string;
  direction: Direction;
  leverage?: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  date: Date;
  isOpen: boolean;
}

// Asset info
export interface Asset {
  symbol: string;
  name: string;
  decimals: number;
}

// Order form state
export interface OrderFormState {
  asset: string;
  direction: Direction;
  collateral: string;
  leverage: number;
}
