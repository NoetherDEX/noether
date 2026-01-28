/**
 * Noether Keeper Bot - Type Definitions
 */

// Direction enum matching contract
export type Direction = 'Long' | 'Short';

// Order type matching contract
export type OrderType = 'LimitEntry' | 'StopLoss' | 'TakeProfit';

// Order status matching contract
export type OrderStatus = 'Pending' | 'Executed' | 'Cancelled' | 'CancelledSlippage' | 'Expired';

// Trigger condition matching contract
export type TriggerCondition = 'Above' | 'Below';

// Position from contract
export interface Position {
  id: bigint;
  trader: string;
  asset: string;
  collateral: bigint;
  size: bigint;
  entry_price: bigint;
  direction: Direction;
  leverage: number;
  liquidation_price: bigint;
  timestamp: bigint;
  last_funding_time: bigint;
  accumulated_funding: bigint;
}

// Order from contract
export interface Order {
  id: bigint;
  trader: string;
  asset: string;
  order_type: OrderType;
  direction: Direction;
  collateral: bigint;
  leverage: number;
  trigger_price: bigint;
  trigger_condition: TriggerCondition;
  slippage_tolerance_bps: number;
  position_id: bigint;
  has_position: boolean;
  created_at: bigint;
  status: OrderStatus;
}

// Price data
export interface PriceData {
  asset: string;
  price: number;
  priceScaled: bigint;
  timestamp: number;
}

// Keeper statistics
export interface KeeperStats {
  startTime: Date;
  oracleUpdates: number;
  liquidationsExecuted: number;
  ordersExecuted: number;
  ordersCancelledSlippage: number;
  ordersSkippedOrphaned: number;
  totalRewardsEarned: bigint;
  errors: number;
}

// Execution result
export interface ExecutionResult {
  success: boolean;
  txHash?: string;
  reward?: bigint;
  error?: string;
}

// Asset configuration
export interface AssetConfig {
  symbol: string;
  binanceSymbol: string;
  decimals: number;
}

// Keeper configuration
export interface KeeperConfig {
  // Network
  network: 'testnet' | 'mainnet';
  rpcUrl: string;
  networkPassphrase: string;

  // Credentials
  secretKey: string;

  // Contract addresses
  marketContractId: string;
  oracleContractId: string;
  vaultContractId: string;

  // Timing
  pollIntervalMs: number;
  oracleUpdateIntervalMs: number;

  // Assets to monitor
  assets: AssetConfig[];
}
