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
    pub liquidation_price: i128,
    /// Timestamp when position was opened (Unix seconds)
    pub timestamp: u64,
    /// Last funding rate applied (for tracking)
    pub last_funding_time: u64,
    /// Accumulated funding payments (positive = paid, negative = received)
    pub accumulated_funding: i128,
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

/// Extended price data with source information
#[contracttype]
#[derive(Clone, Debug)]
pub struct OraclePriceData {
    /// Asset price with 7 decimal places
    pub price: i128,
    /// Unix timestamp when price was fetched
    pub timestamp: u64,
    /// Oracle source identifier ("band", "dia", or "aggregated")
    pub source: Symbol,
    /// Confidence level (basis points, 10000 = 100% confident)
    pub confidence: u32,
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
    pub trading_fee_bps: u32,
    /// Base funding rate in basis points per hour
    pub base_funding_rate_bps: u32,
    /// Maximum position size in USD (7 decimals)
    pub max_position_size: i128,
    /// Oracle staleness threshold in seconds
    pub max_price_staleness: u64,
    /// Maximum allowed oracle deviation in basis points
    pub max_oracle_deviation_bps: u32,
}

impl Default for MarketConfig {
    fn default() -> Self {
        Self {
            min_collateral: 10 * PRECISION,          // 10 USDC minimum
            max_leverage: 10,                         // 10x max
            maintenance_margin_bps: 100,              // 1% maintenance margin
            liquidation_fee_bps: 500,                 // 5% liquidation fee
            trading_fee_bps: 10,                      // 0.1% trading fee
            base_funding_rate_bps: 1,                 // 0.01% per hour base rate
            max_position_size: 100_000 * PRECISION,  // 100,000 USDC max position
            max_price_staleness: 60,                  // 60 seconds max staleness
            max_oracle_deviation_bps: 100,            // 1% max oracle deviation
        }
    }
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

/// Oracle configuration
#[contracttype]
#[derive(Clone, Debug)]
pub struct OracleConfig {
    /// Primary oracle contract address (Band)
    pub primary_oracle: Address,
    /// Secondary oracle contract address (DIA)
    pub secondary_oracle: Address,
    /// Maximum staleness in seconds
    pub max_staleness: u64,
    /// Maximum deviation between oracles in basis points
    pub max_deviation_bps: u32,
    /// Whether to require both oracles (true) or allow single oracle fallback
    pub require_both: bool,
}
