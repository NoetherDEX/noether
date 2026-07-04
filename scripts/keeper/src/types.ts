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
  /** Cumulative funding rate at position open (contract field, PRECISION units). */
  entry_cumulative_funding: bigint;
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
  /** Oracle pushes skipped by publish-path defenses (bands / jump bounds / reference divergence). */
  priceSkips: number;
  /** Whole-snapshot read failures (K-4 — reads that errored, not "empty"). */
  readFailures: number;
  /** Successful sync_asset_pnl NAV freshener calls. */
  syncPnlPushes: number;
  /** Trailing-stop peak updates actually submitted (post-simulation). */
  trailingPeakUpdates: number;
  /** apply_funding submissions that landed. */
  fundingApplications: number;
}

// Execution result
export interface ExecutionResult {
  success: boolean;
  txHash?: string;
  reward?: bigint;
  error?: string;
  /**
   * True when the transaction was submitted but never confirmed within the
   * polling window (NOT_FOUND after poll) — it may still land on-chain.
   * Callers must not treat this as a clean failure nor blindly resubmit.
   */
  indeterminate?: boolean;
}

/** Outcome of a preview simulation (simulate-before-submit pattern). */
export type SimulationOutcome =
  | { ok: true; retval: unknown }
  | { ok: false; error: string };

/** Tri-state result of an apply_funding attempt (K-7). */
export type FundingOutcome = 'applied' | 'not-due' | 'failed';

// Asset configuration
export interface AssetConfig {
  symbol: string;
  decimals: number;
  /** Max allowed % move vs the last pushed price per push interval (K-2). */
  maxMovePct: number;
  /** Absolute sanity band, USD (K-2). Prices outside are never pushed. */
  minPrice: number;
  maxPrice: number;
}

/** Where the signing key was resolved from (K-8). */
export type KeySource = 'KEEPER_SECRET_KEY' | 'ORACLE_SECRET_KEY' | 'ADMIN_SECRET_KEY';

// Keeper configuration
export interface KeeperConfig {
  // Network
  network: 'testnet' | 'mainnet';
  /** Primary RPC URL (first entry of rpcUrls — kept for compatibility). */
  rpcUrl: string;
  /** All RPC endpoints, primary first. Rotated on transient failure (K-6). */
  rpcUrls: string[];
  networkPassphrase: string;

  // Credentials
  secretKey: string;
  keySource: KeySource;

  // Contract addresses
  marketContractId: string;
  /** Noeracle on-chain contract — destination for update_ed25519_persistent. */
  noeracleContractId: string;
  vaultContractId: string;
  /** Router — extended by the TTL job (P3-9). */
  routerContractId: string;
  /** Noeracle shim — extended by the TTL job (P3-9). */
  shimContractId: string;

  // Timing
  pollIntervalMs: number;
  oracleUpdateIntervalMs: number;

  // TTL bump job (P3-9) + wallet-funding alarm (P3-10)
  /** How often to extend contract instance TTLs. */
  ttlBumpIntervalMs: number;
  /** Ledger count to extend instance+code TTL to (~30 days). */
  ttlExtendToLedgers: number;
  /** Alert when the keeper wallet's XLM balance drops below this. */
  minKeeperXlm: number;

  // Reliability (K-1)
  /** Exit(1) when no cycle completed within this window; Railway restarts. */
  watchdogTimeoutMs: number;
  /** Alert after this many consecutive main-cycle errors. */
  alertErrorStreak: number;

  // Publish-path defenses (K-2)
  /** File the circuit-breaker state (last pushed prices) persists to. */
  stateFilePath: string;
  /** Independent public ticker endpoint (Binance-style ?symbol=BTCUSDT). */
  referenceTickerUrl: string;
  /** Skip the push when attestation vs reference diverges more than this %. */
  referenceDivergencePct: number;

  // Alerting (K-1)
  discordWebhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;

  // Assets to monitor
  assets: AssetConfig[];
}

/** Persisted last-pushed price (survives restarts — K-2). */
export interface PersistedPrice {
  price: number;
  /** 7-decimal scaled price as decimal string (JSON-safe bigint). */
  priceScaled: string;
  /** ms epoch of the successful push. */
  timestamp: number;
}

/** On-disk keeper state (KEEPER_STATE_FILE). */
export interface KeeperState {
  lastPushedPrices: Record<string, PersistedPrice>;
  /** ms epoch of the last apply_funding submit that landed (K-7). */
  lastFundingSubmitTime?: number;
}
