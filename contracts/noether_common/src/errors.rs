//! # Error Definitions
//!
//! All possible errors in the Noether protocol.
//! Error codes are grouped by category for easy identification.
//! HARD LIMIT (verified 2026-07-18): `#[contracterror]` caps the enum at ~50
//! VARIANTS (the macro panics `LengthExceedsMax` above it) — the discriminant
//! VALUES are free u32s, but the COUNT is bounded. We're at the ceiling; adding
//! a code means removing a genuinely-dead one first (see the REMOVED markers).

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
    /// A partial close / reduce-only would leave a residual position below
    /// the minimum collateral floor (L0-6). Close the whole position instead.
    PositionTooSmall = 27,

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
    /// Deposit would exceed the per-account guarded-launch cap
    DepositCapExceeded = 43,

    // ═══════════════════════════════════════════════════════════════
    // Liquidation Errors (50-54)
    // ═══════════════════════════════════════════════════════════════

    /// Position is healthy and cannot be liquidated
    NotLiquidatable = 50,
    // 51 LiquidationFailed REMOVED (L1-24/28): freed a slot for the ~50-variant
    // contracterror cap (LengthExceedsMax). Never returned anywhere.

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
    // 63 SlippageExceeded REMOVED (L1-24/28): slippage is handled by
    // cancel-and-refund (CancelledSlippage status), never this error. Freed a
    // slot for the contracterror variant cap.
    /// Caller does not own this order
    NotOrderOwner = 64,
    /// Invalid trigger price (e.g., stop-loss above entry for long)
    InvalidTriggerPrice = 65,
    /// Invalid slippage tolerance (must be > 0 and <= 10000 bps)
    InvalidSlippageTolerance = 66,
    /// Position already has this type of order attached
    OrderAlreadyExists = 67,
    /// Invalid limit price for stop-limit order
    InvalidLimitPrice = 68,
    /// Invalid trailing percentage (must be 1-5000 bps = 0.01%-50%)
    InvalidTrailingPercent = 69,
    /// Post-only order would execute immediately (rejected)
    PostOnlyViolation = 70,

    // ═══════════════════════════════════════════════════════════════
    // Cross-Margin Errors (76-80)
    // ═══════════════════════════════════════════════════════════════

    /// Cross-margin pool has insufficient balance for operation
    CrossMarginInsufficientBalance = 76,
    /// Cannot withdraw: would leave insufficient free margin
    CrossMarginInsufficientFreeMargin = 77,
    /// Cross-margin account is not liquidatable
    CrossMarginNotLiquidatable = 78,
    /// No cross-margin positions found for this trader
    CrossMarginNoPositions = 79,
    /// SL/TP/trailing-stop orders are not supported on cross-margin
    /// positions (they would execute via the isolated path and pay
    /// out of the shared pool)
    CrossMarginOrderNotSupported = 80,
    /// Oracle price moved beyond max_oracle_deviation_bps vs the stored
    /// last-good price (opens halt; closes/liquidations stay allowed)
    PriceDeviationTooHigh = 81,
    /// Open would exceed the per-asset-side OI cap or the aggregate
    /// payout-reservation cap (both sized against vault AUM)
    OpenInterestCapExceeded = 82,
    /// A partial liquidation ran recently: this position is inside its
    /// grace period and cannot be liquidated again yet (bankruptcy
    /// overrides the grace period)
    LiquidationCooldown = 83,
    /// adl_close called while ADL is not active for the position's asset
    /// (L0-1; check_adl_trigger or a shortfall settle flips the flag)
    AdlNotActive = 84,
    /// adl_close target is not a net winner at the current mark — only
    /// positive-uPnL positions are ADL candidates (L0-1)
    AdlNotEligible = 85,
    // 86 LiquidationNotConfirmed — reserved for L0-9 (smoothed mark)
    /// A market open/close filled worse than the trader's acceptable_price
    /// bound (L0-10). The tx reverts; resubmit with 0 to fill unbounded.
    AcceptablePriceExceeded = 87,
    /// A risk-increasing op (open / limit / stop-limit placement) hit an
    /// asset with no per-market risk params configured — fail-closed
    /// (L0-12). Risk-reducing paths fall back to the legacy MM instead.
    AssetRiskNotConfigured = 88,
    /// An open would push the asset's net long-short skew past its cap and
    /// make it MORE imbalanced (L0-14). Skew-reducing opens always pass.
    SkewCapExceeded = 89,
    /// Full-freeze pause (mode 2): even risk-reducing ops — closes,
    /// liquidations, cross deposits/withdrawals, stops, funding — are halted
    /// symmetrically (L0-15). Only cancel_order works; auto-degrades to
    /// halt-open (closes/liquidations allowed) after 72h.
    Frozen = 90,
    /// An open auto-nets to zero or beyond against the trader's opposite
    /// same-asset positions — gross opposite >= requested size, too many
    /// opposing legs, or a sub-min remainder (L1-3). Reductions and flips
    /// go through the close/reduce-only paths, never a one-tx flip.
    NetsToZero = 91,
    /// Trading in this specific market is temporarily halted by admin (L1-24).
    /// Risk-increasing paths only — closing/liquidating a position still works.
    AssetHalted = 92,
    /// LP withdrawal is inside the post-deposit cooldown window (L1-28) — an
    /// anti-JIT/NAV-sniping delay after each deposit. Everything else is instant.
    WithdrawCooldownActive = 93,
}
