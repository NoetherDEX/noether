//! # Error Definitions
//!
//! All possible errors in the Noether protocol.
//! Error codes are grouped by category for easy identification.
//! Note: Soroban contracterror has a limit of ~48 variants, so we consolidate similar errors.

use soroban_sdk::contracterror;

/// Noether protocol errors
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum NoetherError {
    // ═══════════════════════════════════════════════════════════════
    // General Errors (1-19)
    // ═══════════════════════════════════════════════════════════════

    /// Contract has not been initialized
    NotInitialized = 1,
    /// Contract has already been initialized
    AlreadyInitialized = 2,
    /// Caller is not authorized for this operation
    Unauthorized = 3,
    /// Operation is currently paused
    Paused = 4,
    /// Invalid input parameter
    InvalidParameter = 5,
    /// Arithmetic overflow occurred
    Overflow = 6,
    /// Division by zero attempted
    DivisionByZero = 7,

    // ═══════════════════════════════════════════════════════════════
    // Position Errors (20-29)
    // ═══════════════════════════════════════════════════════════════

    /// Position with given ID does not exist
    PositionNotFound = 20,
    /// Leverage must be between 1 and max_leverage (typically 10)
    InvalidLeverage = 21,
    /// Collateral amount is below minimum required
    InsufficientCollateral = 22,
    /// Position size exceeds maximum allowed
    PositionTooLarge = 23,
    /// Caller does not own this position
    NotPositionOwner = 24,
    /// Position has insufficient margin for operation
    InsufficientMargin = 25,

    // ═══════════════════════════════════════════════════════════════
    // Oracle Errors (30-39)
    // ═══════════════════════════════════════════════════════════════

    /// Oracle price is older than max staleness threshold
    PriceStale = 30,
    /// Invalid price returned (zero or negative)
    InvalidPrice = 31,
    /// Oracle is not responding or unavailable
    OracleUnavailable = 32,

    // ═══════════════════════════════════════════════════════════════
    // Vault Errors (40-49)
    // ═══════════════════════════════════════════════════════════════

    /// Insufficient USDC liquidity in vault
    InsufficientLiquidity = 40,
    /// Amount must be positive
    InvalidAmount = 41,
    /// Insufficient balance for operation
    InsufficientBalance = 42,

    // ═══════════════════════════════════════════════════════════════
    // Liquidation Errors (50-54)
    // ═══════════════════════════════════════════════════════════════

    /// Position is healthy and cannot be liquidated
    NotLiquidatable = 50,
    /// Liquidation operation failed
    LiquidationFailed = 51,

    // ═══════════════════════════════════════════════════════════════
    // Funding Rate Errors (55-59)
    // ═══════════════════════════════════════════════════════════════

    /// Funding interval not elapsed
    FundingIntervalNotElapsed = 55,

    // ═══════════════════════════════════════════════════════════════
    // Order Errors (60-75)
    // ═══════════════════════════════════════════════════════════════

    /// Order with given ID does not exist
    OrderNotFound = 60,
    /// Order has already been executed or cancelled
    OrderNotPending = 61,
    /// Order trigger condition not met (price hasn't reached trigger)
    OrderNotTriggered = 62,
    /// Slippage exceeds trader's tolerance
    SlippageExceeded = 63,
    /// Caller does not own this order
    NotOrderOwner = 64,
    /// Invalid trigger price (e.g., stop-loss above entry for long)
    InvalidTriggerPrice = 65,
    /// Invalid slippage tolerance (must be > 0 and <= 10000 bps)
    InvalidSlippageTolerance = 66,
    /// Position already has this type of order attached
    OrderAlreadyExists = 67,
}
