//! # Core Data Types
//!
//! This module defines all shared data structures used across the Noether protocol.

use soroban_sdk::{contracttype, Address, Symbol};

/// Decimal precision for prices and amounts.
/// Stellar uses 7 decimals natively, so we follow the same convention.
/// Example: 1.0000000 XLM = 10_000_000 stroops
pub const PRECISION: i128 = 10_000_000; // 10^7

/// Basis points precision (1 bp = 0.01%)
/// 10000 basis points = 100%
pub const BASIS_POINTS: u32 = 10_000;

/// Shared storage-TTL bump parameters (V-6). Ledgers close ~every 5s, so these
/// are ~1 day and ~30 days. Bump only when the remaining TTL drops below the
/// threshold, and extend to ~30 days — used by every contract's storage layer
/// (market, vault, vault_factory, router, shim) so an archived instance can't
/// silently kill one contract while the others stay live.
pub const TTL_THRESHOLD: u32 = 17_280; // ~1 day at 5s ledgers
pub const TTL_EXTEND_TO: u32 = 518_400; // ~30 days at 5s ledgers

/// Max fraction of vault AUM that may be committed as open-position payout
/// reservations (M-4/V-3). At 70% the pool always keeps a buffer for LP
/// withdrawals and adverse moves. Tunable within the audited 60–75% band.
pub const RESERVE_CAP_BPS: u32 = 7_000;

/// Noeracle's on-chain 8-byte asset tag: `ASCII(<symbol>USD)` zero-padded to 8
/// bytes — the first 8 bytes of Noeracle's signed attestation message. Shared by
/// the router (which WRITES the slot) and the shim (which READS it) so the two
/// can never derive different slots for the same asset (O-8). Hardcoded for the
/// three launch pairs; adding a pair means redeploying both. Returns
/// `InvalidPrice` for an unknown symbol.
pub fn symbol_to_tag(
    env: &soroban_sdk::Env,
    asset: &Symbol,
) -> Result<soroban_sdk::BytesN<8>, crate::errors::NoetherError> {
    let btc = Symbol::new(env, "BTC");
    let eth = Symbol::new(env, "ETH");
    let xlm = Symbol::new(env, "XLM");

    let bytes: [u8; 8] = if asset == &btc {
        [b'B', b'T', b'C', b'U', b'S', b'D', 0, 0]
    } else if asset == &eth {
        [b'E', b'T', b'H', b'U', b'S', b'D', 0, 0]
    } else if asset == &xlm {
        [b'X', b'L', b'M', b'U', b'S', b'D', 0, 0]
    } else {
        return Err(crate::errors::NoetherError::InvalidPrice);
    };

    Ok(soroban_sdk::BytesN::from_array(env, &bytes))
}

#[cfg(test)]
mod tag_tests {
    use super::symbol_to_tag;
    use soroban_sdk::{Env, Symbol};

    #[test]
    fn tags_match_noeracle_message_prefix() {
        let env = Env::default();
        assert_eq!(
            symbol_to_tag(&env, &Symbol::new(&env, "BTC")).unwrap().to_array(),
            [b'B', b'T', b'C', b'U', b'S', b'D', 0, 0],
        );
        assert_eq!(
            symbol_to_tag(&env, &Symbol::new(&env, "ETH")).unwrap().to_array(),
            [b'E', b'T', b'H', b'U', b'S', b'D', 0, 0],
        );
        assert_eq!(
            symbol_to_tag(&env, &Symbol::new(&env, "XLM")).unwrap().to_array(),
            [b'X', b'L', b'M', b'U', b'S', b'D', 0, 0],
        );
        assert!(symbol_to_tag(&env, &Symbol::new(&env, "DOGE")).is_err());
    }
}

/// Fee precision for sub-basis-point fee rates.
/// 1 unit = 0.1 bps = 0.001%. 100_000 units = 100%.
/// This allows representing rates like 1.5 bps (= 15 fee units).
pub const FEE_PRECISION: i128 = 100_000;

/// Direction of a trading position
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Copy)]
pub enum Direction {
    /// Long position - profits when price goes UP
    Long = 0,
    /// Short position - profits when price goes DOWN
    Short = 1,
}

/// Status of a position
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Copy)]
pub enum PositionStatus {
    /// Position is active and open
    Open = 0,
    /// Position was closed by the trader
    Closed = 1,
    /// Position was liquidated
    Liquidated = 2,
}

// ═══════════════════════════════════════════════════════════════════════════
// Margin Mode
// ═══════════════════════════════════════════════════════════════════════════

/// Margin mode for a position
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Copy)]
pub enum MarginMode {
    /// Isolated margin - each position has its own collateral (default)
    Isolated = 0,
    /// Cross margin - shares collateral pool across all cross positions
    Cross = 1,
}

/// A trader's leveraged position
#[contracttype]
#[derive(Clone, Debug)]
pub struct Position {
    /// Unique position identifier
    pub id: u64,
    /// Address of the trader who owns this position
    pub trader: Address,
    /// Trading asset symbol (e.g., "XLM")
    pub asset: Symbol,
    /// USDC collateral deposited as margin (7 decimals)
    pub collateral: i128,
    /// Position size in USD value (7 decimals)
    /// size = collateral * leverage
    pub size: i128,
    /// Price when position was opened (7 decimals)
    pub entry_price: i128,
    /// Position direction (Long or Short)
    pub direction: Direction,
    /// Leverage multiplier (1-10)
    pub leverage: u32,
    /// Price at which position will be liquidated (7 decimals)
    /// For cross-margin positions, this is 0 (liquidation is account-level)
    pub liquidation_price: i128,
    /// Timestamp when position was opened (Unix seconds)
    pub timestamp: u64,
    /// Cumulative funding rate at position open (for accurate funding calc)
    pub entry_cumulative_funding: i128,
    /// Margin mode: 0 = Isolated, 1 = Cross
    pub margin_mode: u32,
}

/// Cross-margin account info (view return type)
#[contracttype]
#[derive(Clone, Debug)]
pub struct CrossMarginInfo {
    /// Total balance in cross-margin pool (7 decimals)
    pub balance: i128,
    /// Account equity = balance + sum(unrealized PnL) - sum(funding) (7 decimals)
    pub equity: i128,
    /// Total initial margin used by cross positions (7 decimals)
    pub used_margin: i128,
    /// Free margin available = equity - used_margin (7 decimals)
    pub free_margin: i128,
    /// Margin ratio = equity / used_margin * 10000 (basis points)
    pub margin_ratio_bps: i128,
    /// Number of open cross-margin positions
    pub position_count: u32,
}

/// Price data from oracles
#[contracttype]
#[derive(Clone, Debug)]
pub struct PriceData {
    /// Asset price with 7 decimal places
    pub price: i128,
    /// Unix timestamp when price was fetched
    pub timestamp: u64,
}


/// Vault/Pool information snapshot
#[contracttype]
#[derive(Clone, Debug)]
pub struct PoolInfo {
    /// Total USDC deposited in the pool (7 decimals)
    pub total_usdc: i128,
    /// Total GLP tokens minted (7 decimals)
    pub total_glp: i128,
    /// Assets Under Management (7 decimals)
    /// AUM = total_usdc - unrealized_trader_pnl
    pub aum: i128,
    /// Unrealized PnL of all open positions (7 decimals)
    /// Positive = traders are winning (bad for LPs)
    /// Negative = traders are losing (good for LPs)
    pub unrealized_pnl: i128,
    /// Total fees collected (7 decimals)
    pub total_fees: i128,
}

/// Market statistics
#[contracttype]
#[derive(Clone, Debug)]
pub struct MarketStats {
    /// Total value of all long positions (7 decimals)
    pub total_long_size: i128,
    /// Total value of all short positions (7 decimals)
    pub total_short_size: i128,
    /// Total number of open positions
    pub open_position_count: u64,
    /// Current funding rate (basis points per hour)
    /// Positive = longs pay shorts
    /// Negative = shorts pay longs
    pub funding_rate: i128,
    /// Last time funding was applied
    pub last_funding_time: u64,
}

/// Configuration for the Market contract
#[contracttype]
#[derive(Clone, Debug)]
pub struct MarketConfig {
    /// Minimum collateral required to open a position (7 decimals)
    pub min_collateral: i128,
    /// Maximum leverage allowed (1-10)
    pub max_leverage: u32,
    /// Maintenance margin in basis points (e.g., 100 = 1%)
    pub maintenance_margin_bps: u32,
    /// Liquidation fee in basis points (e.g., 500 = 5%)
    pub liquidation_fee_bps: u32,
    /// Trading fee in basis points (e.g., 10 = 0.1%)
    /// DEPRECATED: Use base_maker_fee_bps / base_taker_fee_bps instead.
    /// Kept for backward compatibility with existing deployments.
    pub trading_fee_bps: u32,
    /// Base funding rate in basis points per hour
    pub base_funding_rate_bps: u32,
    /// Maximum position size in USD (7 decimals)
    pub max_position_size: i128,
    /// Oracle staleness threshold in seconds
    pub max_price_staleness: u64,
    /// Maximum allowed oracle deviation in basis points
    pub max_oracle_deviation_bps: u32,
    /// Base maker fee in basis points (e.g., 2 = 0.02%)
    /// Maker = limit orders resting on the order book
    pub base_maker_fee_bps: u32,
    /// Base taker fee in basis points (e.g., 5 = 0.05%)
    /// Taker = market orders, immediate fills
    pub base_taker_fee_bps: u32,
}

impl Default for MarketConfig {
    fn default() -> Self {
        Self {
            min_collateral: 10 * PRECISION,          // 10 USDC minimum
            max_leverage: 10,                         // 10x max
            maintenance_margin_bps: 100,              // 1% maintenance margin
            liquidation_fee_bps: 500,                 // 5% liquidation fee
            trading_fee_bps: 10,                      // 0.1% (deprecated, fallback)
            base_funding_rate_bps: 1,                 // 0.01% per hour base rate
            max_position_size: 100_000 * PRECISION,  // 100,000 USDC max position
            max_price_staleness: 60,                  // 60 seconds max staleness
            max_oracle_deviation_bps: 100,            // 1% max oracle deviation
            base_maker_fee_bps: 2,                    // 0.02% maker fee
            base_taker_fee_bps: 5,                    // 0.05% taker fee
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Fee Tier System (Maker/Taker with Volume Discounts)
// ═══════════════════════════════════════════════════════════════════════════

/// A volume-based fee tier.
/// Users with higher 14-day rolling volume get lower fees.
/// Fee rates use deci-bps (0.1 bps = 0.001%) for sub-basis-point precision.
/// Example: maker_fee_bps=15 means 1.5 bps = 0.015%.
/// Divide by FEE_PRECISION (100_000) when calculating fee amounts.
#[contracttype]
#[derive(Clone, Debug)]
pub struct FeeTier {
    /// Minimum 14-day rolling volume to qualify for this tier (7 decimals)
    pub min_volume: i128,
    /// Maker fee rate in deci-bps (1 unit = 0.001%)
    pub maker_fee_bps: u32,
    /// Taker fee rate in deci-bps (1 unit = 0.001%)
    pub taker_fee_bps: u32,
}

/// Per-trader 14-day rolling volume record.
/// Uses a fixed 14-slot circular buffer, one slot per day.
#[contracttype]
#[derive(Clone, Debug)]
pub struct VolumeRecord {
    /// Daily volume for each of the last 14 days (7 decimals each)
    pub daily_volumes: soroban_sdk::Vec<i128>,
    /// The day number (unix_timestamp / 86400) when this record was last updated
    pub last_update_day: u64,
}

/// Fee information for a specific trader (view return type)
#[contracttype]
#[derive(Clone, Debug)]
pub struct TraderFeeInfo {
    /// Total 14-day rolling volume (7 decimals)
    pub volume_14d: i128,
    /// Current fee tier index (0-3)
    pub tier: u32,
    /// Maker fee rate in deci-bps (1 unit = 0.001%). E.g., 15 = 1.5 bps = 0.015%
    pub maker_fee_bps: u32,
    /// Taker fee rate in deci-bps (1 unit = 0.001%). E.g., 50 = 5.0 bps = 0.050%
    pub taker_fee_bps: u32,
    /// Volume needed to reach next tier (7 decimals, 0 if already max tier)
    pub next_tier_volume: i128,
}

/// Asset type for oracle price queries (SEP-0040 compatible)
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AssetType {
    /// Stellar native asset (XLM)
    Stellar,
    /// Other assets identified by symbol string
    Other(Symbol),
}


// ═══════════════════════════════════════════════════════════════════════════
// Order Types (Limit Orders, Stop-Loss, Take-Profit)
// ═══════════════════════════════════════════════════════════════════════════

/// Type of conditional order
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Copy)]
pub enum OrderType {
    /// Limit entry order - open a new position when price reaches trigger
    LimitEntry = 0,
    /// Stop-loss order - close position to limit losses
    StopLoss = 1,
    /// Take-profit order - close position to lock in profits
    TakeProfit = 2,
    /// Stop-limit: when stop price triggers, place a limit order at limit_price
    StopLimit = 3,
    /// Trailing stop: dynamic stop that follows peak price by trailing_percent
    TrailingStop = 4,
}

/// Trigger condition for order execution
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Copy)]
pub enum TriggerCondition {
    /// Execute when price >= trigger_price
    Above = 0,
    /// Execute when price <= trigger_price
    Below = 1,
}

/// Status of an order
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Copy)]
pub enum OrderStatus {
    /// Order is pending execution
    Pending = 0,
    /// Order was executed successfully
    Executed = 1,
    /// Order was cancelled by trader
    Cancelled = 2,
    /// Order was cancelled due to slippage exceeded
    CancelledSlippage = 3,
    /// Order expired (for future use)
    Expired = 4,
}

/// A conditional order (limit entry, stop-loss, take-profit, stop-limit, trailing stop)
#[contracttype]
#[derive(Clone, Debug)]
pub struct Order {
    /// Unique order identifier
    pub id: u64,
    /// Address of the trader who placed this order
    pub trader: Address,
    /// Trading asset symbol (e.g., "BTC", "ETH", "XLM")
    pub asset: Symbol,
    /// Type of order (LimitEntry, StopLoss, TakeProfit, StopLimit, TrailingStop)
    pub order_type: OrderType,
    /// Direction for the position (Long or Short) - used for LimitEntry
    pub direction: Direction,
    /// USDC collateral locked (for LimitEntry/StopLimit orders)
    pub collateral: i128,
    /// Leverage multiplier (for LimitEntry/StopLimit orders)
    pub leverage: u32,
    /// Price at which to trigger the order (7 decimals)
    pub trigger_price: i128,
    /// Trigger condition (Above or Below)
    pub trigger_condition: TriggerCondition,
    /// Maximum allowed slippage in basis points (e.g., 100 = 1%)
    pub slippage_tolerance_bps: u32,
    /// Position ID this order is attached to (for SL/TP/TrailingStop orders)
    pub position_id: u64,
    /// Whether this order is attached to a position
    pub has_position: bool,
    /// Timestamp when order was created (Unix seconds)
    pub created_at: u64,
    /// Current status of the order
    pub status: OrderStatus,
    /// Limit price for StopLimit orders (7 decimals). 0 = not applicable.
    pub limit_price: i128,
    /// Trailing percentage in basis points for TrailingStop (e.g., 200 = 2%). 0 = not applicable.
    pub trailing_percent_bps: u32,
    /// Time-in-force: 0=GTC (default), 1=IOC, 2=PostOnly
    pub time_in_force: u32,
    /// StopLimit phase: 0=WaitingForStop, 1=LimitActive
    pub stop_limit_phase: u32,
}

/// Keeper fee configuration for order execution
#[contracttype]
#[derive(Clone, Debug)]
pub struct KeeperFeeConfig {
    /// Base fee in USDC (7 decimals) - e.g., 5_000_000 = 0.50 USDC
    pub base_fee: i128,
    /// Variable fee in basis points of position size - e.g., 5 = 0.05%
    pub variable_fee_bps: u32,
}

impl Default for KeeperFeeConfig {
    fn default() -> Self {
        Self {
            base_fee: 5_000_000,    // 0.50 USDC
            variable_fee_bps: 5,    // 0.05%
        }
    }
}
