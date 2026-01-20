//! # Error Definitions
//!
//! All possible errors in the Noether protocol.
//! Error codes are grouped by category for easy identification.

use soroban_sdk::contracterror;

/// Noether protocol errors
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum NoetherError {
    // ═══════════════════════════════════════════════════════════════
    // General Errors (1-99)
    // ═══════════════════════════════════════════════════════════════

    /// Contract has not been initialized
    NotInitialized = 1,
    /// Contract has already been initialized
    AlreadyInitialized = 2,
    /// Caller is not authorized for this operation
    Unauthorized = 3,
    /// Operation is currently paused
    Paused = 4,
    /// Operation requires contract to be paused
    NotPaused = 9,
    /// Invalid input parameter
    InvalidParameter = 5,
    /// Arithmetic overflow occurred
    Overflow = 6,
    /// Arithmetic underflow occurred
    Underflow = 7,
    /// Division by zero attempted
    DivisionByZero = 8,

    // ═══════════════════════════════════════════════════════════════
    // Position Errors (100-199)
    // ═══════════════════════════════════════════════════════════════

    /// Position with given ID does not exist
    PositionNotFound = 100,
    /// Position already exists (duplicate ID)
    PositionAlreadyExists = 101,
    /// Leverage must be between 1 and max_leverage (typically 10)
    InvalidLeverage = 102,
    /// Collateral amount is below minimum required
    InsufficientCollateral = 103,
    /// Position size is below minimum threshold
    PositionTooSmall = 104,
    /// Position size exceeds maximum allowed
    PositionTooLarge = 105,
    /// Caller does not own this position
    NotPositionOwner = 106,
    /// Position is already closed
    PositionAlreadyClosed = 107,
    /// Invalid direction specified
    InvalidDirection = 108,
    /// Cannot close position with this method (use liquidate)
    PositionUnderwater = 109,
    /// Position has insufficient margin for operation
    InsufficientMargin = 110,

    // ═══════════════════════════════════════════════════════════════
    // Oracle Errors (200-299)
    // ═══════════════════════════════════════════════════════════════

    /// Oracle price is older than max staleness threshold
    PriceStale = 200,
    /// Primary and secondary oracle prices deviate too much
    PriceDeviation = 201,
    /// Oracle is not responding or unavailable
    OracleUnavailable = 202,
    /// Invalid price returned (zero or negative)
    InvalidPrice = 203,
    /// Asset not supported by oracle
    AssetNotSupported = 204,
    /// Oracle contract address is invalid
    InvalidOracleAddress = 205,
    /// Both oracles failed and no fallback available
    AllOraclesFailed = 206,

    // ═══════════════════════════════════════════════════════════════
    // Vault Errors (300-399)
    // ═══════════════════════════════════════════════════════════════

    /// Insufficient USDC liquidity in vault
    InsufficientLiquidity = 300,
    /// Withdrawal cooldown period not elapsed
    WithdrawalCooldown = 301,
    /// Amount must be positive
    InvalidAmount = 302,
    /// Insufficient GLP balance for withdrawal
    InsufficientGlpBalance = 303,
    /// Deposit would exceed pool capacity
    PoolCapacityExceeded = 304,
    /// Withdrawal would leave pool undercollateralized
    WithdrawalWouldUndercollateralize = 305,
    /// Cannot settle - caller is not the market contract
    UnauthorizedSettlement = 306,
    /// GLP price calculation failed
    GlpPriceError = 307,

    // ═══════════════════════════════════════════════════════════════
    // Liquidation Errors (400-499)
    // ═══════════════════════════════════════════════════════════════

    /// Position is healthy and cannot be liquidated
    NotLiquidatable = 400,
    /// Position has already been liquidated
    AlreadyLiquidated = 401,
    /// Liquidation would result in negative payout
    LiquidationFailed = 402,
    /// Keeper reward calculation failed
    KeeperRewardError = 403,

    // ═══════════════════════════════════════════════════════════════
    // Token Errors (500-599)
    // ═══════════════════════════════════════════════════════════════

    /// Token transfer failed
    TransferFailed = 500,
    /// Insufficient token balance
    InsufficientBalance = 501,
    /// Token approval failed
    ApprovalFailed = 502,
    /// Invalid token address
    InvalidTokenAddress = 503,

    // ═══════════════════════════════════════════════════════════════
    // Funding Rate Errors (600-699)
    // ═══════════════════════════════════════════════════════════════

    /// Funding rate calculation failed
    FundingCalculationError = 600,
    /// Funding interval not elapsed
    FundingIntervalNotElapsed = 601,
}
