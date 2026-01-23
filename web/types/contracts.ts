// Position direction
export type Direction = 'Long' | 'Short';

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
  lastFundingAt: number;
  accumulatedFunding: bigint;
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
  fee: number;
  timestamp: Date;
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
