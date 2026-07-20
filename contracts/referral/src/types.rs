//! On-chain types for the referral contract.

use soroban_sdk::{contracterror, contracttype, Address, String};

/// Default referee fee discount = 4% (in basis points).
pub const DEFAULT_DISCOUNT_BPS: u32 = 400;

/// Default referrer share of each referred trade's fee = 10% (in bps).
pub const DEFAULT_REFERRER_SHARE_BPS: u32 = 1_000;

/// Cap protecting against admin misconfiguration.
pub const MAX_BPS: u32 = 5_000; // 50%

/// Default minimum 14-day rolling volume required to mint a code = 10k USDC
/// (PRECISION-scaled). Admin-tunable.
pub const DEFAULT_MIN_CODE_VOLUME: i128 = 10_000_0000000;

/// Code length bounds (alphanumeric short codes for share-link UX).
pub const CODE_MIN_LEN: u32 = 3;
pub const CODE_MAX_LEN: u32 = 16;

#[contracttype]
#[derive(Clone, Debug)]
pub struct ReferralInfo {
    pub code: String,
    pub referrer: Address,
    pub created_at: u64,
    /// How many distinct referees have set this referrer.
    pub referred_count: u32,
    /// Total volume the referees have generated through this code.
    pub total_volume_generated: i128,
    /// Lifetime fees earned (claimed + unclaimed).
    pub total_earned: i128,
    /// Currently claimable balance (lifetime - claimed).
    pub claimable: i128,
}

#[contracttype]
#[derive(Clone)]
pub enum StorageKey {
    /// Singleton — admin address.
    Admin,
    /// Singleton — market contract address (only this caller is allowed to
    /// invoke `record_trade`).
    Market,
    /// Singleton — discount applied to referees (basis points).
    DiscountBps,
    /// Singleton — referrer's share of each referred trade's fee (bps).
    ReferrerShareBps,
    /// Singleton — minimum 14-day volume required to create a code.
    MinCodeVolume,
    /// Code -> referrer Address.
    Code(String),
    /// Referrer -> ReferralInfo.
    Info(Address),
    /// Referee -> referrer Address (one referrer per address, set once).
    RefereeOf(Address),
    /// Whether `initialize` has been called.
    Initialized,
    /// Singleton — USDC token the funded claim pays out in (L1-18).
    UsdcToken,
    /// Singleton — registry pause switch (L1-18/R-5): record_trade becomes
    /// a (0,0) no-op, state-changing calls reject with RegistryPaused.
    Paused,
    /// Referrer -> revoked flag (L1-18/R-5): a revoked referrer accrues
    /// nothing and their code cannot take new bindings.
    Revoked(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ReferralError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAdmin = 3,
    NotMarket = 4,
    InvalidParameter = 5,
    CodeTooShort = 6,
    CodeTooLong = 7,
    CodeAlreadyTaken = 8,
    AlreadyHasCode = 9,
    UnknownCode = 10,
    AlreadyHasReferrer = 11,
    SelfReferral = 12,
    InsufficientVolume = 13,
    NothingToClaim = 14,
    Overflow = 15,
    /// The contract's USDC balance cannot cover the claim — claimable is
    /// PRESERVED (never burn an earned balance); retry once the market's
    /// per-trade pot transfers refill the pool (L1-18).
    ClaimUnfunded = 16,
    /// Registry paused by admin — state-changing calls reject (L1-18/R-5).
    RegistryPaused = 17,
    /// The code's referrer has been revoked (L1-18/R-5).
    RevokedCode = 18,
}
