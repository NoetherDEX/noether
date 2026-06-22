/**
 * Noether Keeper Bot - Type Definitions
 */

// Direction enum matching contract
export type Direction = 'Long' | 'Short';

// Order type matching contract
export type OrderType = 'LimitEntry' | 'StopLoss' | 'TakeProfit' | 'StopLimit' | 'TrailingStop';

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
  margin_mode: number; // 0 = Isolated, 1 = Cross
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
  limit_price: bigint;
  trailing_percent_bps: number;
  time_in_force: number; // 0=GTC, 1=IOC, 2=PostOnly
  stop_limit_phase: number; // 0=WaitingForStop, 1=LimitActive
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
  decimals: number;
  /** Max allowed per-push price jump vs the last pushed price (circuit breaker). */
  maxJumpPct: number;
  /** Binance ticker symbol for the independent sanity check (e.g. "BTCUSDT"). */
  binanceSymbol: string;
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
  /** Noeracle on-chain contract — destination for update_ed25519_persistent. */
  noeracleContractId: string;
  vaultContractId: string;

  // Timing
  pollIntervalMs: number;
  oracleUpdateIntervalMs: number;
  /** Exit (for supervisor restart) if no cycle completes within this window. */
  watchdogMs: number;

  /** Discord/Slack-compatible webhook for startup/error-streak/watchdog/shutdown alerts. */
  alertWebhookUrl?: string;

  /** File where last-pushed prices persist so the circuit breaker survives restarts. */
  stateFile: string;
  /** Max divergence from the independent ticker before an attestation push is skipped. */
  referenceDivergencePct: number;

  // Assets to monitor
  assets: AssetConfig[];
}
