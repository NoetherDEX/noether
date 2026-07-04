//! Shared storage-TTL constants (ledger counts, ~5s each).
//!
//! Threshold: re-extend only when the remaining TTL drops below ~1 day,
//! avoiding a rent top-up on every single call. Extend-to: ~30 days.
//! One source of truth for market, vault, factory, referral, router, shim.

pub const TTL_THRESHOLD: u32 = 17_280; // ~1 day
pub const TTL_EXTEND_TO: u32 = 518_400; // ~30 days
