//! # Vault Storage
//!
//! Storage keys and helper functions for the Vault contract.

use noether_common::ttl::{TTL_EXTEND_TO, TTL_THRESHOLD};
use soroban_sdk::{contracttype, Address, Env, Symbol};
use noether_common::NoetherError;

// ═══════════════════════════════════════════════════════════════════════════
// Storage Keys
// ═══════════════════════════════════════════════════════════════════════════

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Admin address
    Admin,
    /// USDC token contract address
    UsdcToken,
    /// NOE token contract address (SAC-wrapped classic asset)
    NoeToken,
    /// Market contract address (authorized for settlements)
    MarketContract,
    /// Total USDC in pool (7 decimals)
    TotalUsdc,
    /// Total NOE circulating (held by users, not in vault) (7 decimals)
    TotalNoeCirculating,
    /// Unrealized trader PnL (7 decimals)
    UnrealizedPnl,
    /// Total fees collected (7 decimals)
    TotalFees,
    /// Deposit fee in basis points
    DepositFeeBps,
    /// Withdrawal fee in basis points
    WithdrawFeeBps,
    /// Whether contract is initialized
    Initialized,
    /// Whether contract is paused
    Paused,
    /// Sum of committed max payouts for open positions (7 decimals)
    ReservedPayout,
    /// OUTSTANDING (unrepaid) winner profit the pool could not pay at close
    /// (7 decimals). Semantics since L0-3: decremented by claim_shortfall —
    /// use CumShortfall for the lifetime-booked figure.
    Shortfall,
    /// Per-trader outstanding short-paid winnings (7 decimals) — claimable
    /// via claim_shortfall (L0-3). Invariant: Shortfall == Σ ShortfallOwed.
    ShortfallOwed(Address),
    /// USDC earmarked for shortfall repayment (7 decimals). A separate bucket:
    /// NOT part of BufferBalance and NOT part of AUM; fed by the
    /// ShortfallInflowBps split of buffer inflows; spent ONLY by
    /// claim_shortfall (L0-3).
    ShortfallReserve,
    /// Lifetime shortfall booked (7 decimals) — history-independent metric.
    CumShortfall,
    /// Lifetime shortfall repaid (7 decimals).
    CumShortfallRepaid,
    /// Share of buffer inflows routed to the shortfall reserve while any
    /// shortfall is outstanding, in bps (default 5000 = 50%).
    ShortfallInflowBps,
    /// Lifetime bankrupt-loss amount the insurance buffer absorbed (L0-2).
    CumBadDebtCovered,
    /// Lifetime bankrupt-loss amount that fell through to LP NAV (L0-2).
    CumBadDebtLpAbsorbed,
    /// Protocol-owned first-loss insurance buffer (7 decimals). Pays trader
    /// wins BEFORE LP value; fed by seed + liquidation penalties + fee share
    /// + net losses. NOT part of LP AUM / NOE price (P5-6).
    BufferBalance,
    /// Per-account cumulative USDC deposited (7 decimals), for the
    /// guarded-launch deposit cap (P6-6).
    Deposited(Address),
    /// Per-account cumulative-deposit cap (7 decimals); 0 = unlimited (P6-6).
    DepositCap,
    /// L1-22: insurance-buffer target as bps of ReservedPayout (default 1000
    /// = 10%). Protocol fees fill the buffer up to target, then overflow to
    /// the treasury; 0 when the book is empty so all fee flow overflows.
    BufferTargetBps,
    /// Max total reservation as bps of AUM (default 7000 = 70%)
    ReserveCapBps,
    /// Per-asset-side OI cap as bps of AUM (default 2500 = 25%)
    AssetCapBps(Symbol),
    /// Unrealized trader PnL per asset (7 decimals)
    AssetUnrealizedPnl(Symbol),
    /// Absolute per-asset-side OI cap, 7-decimal USD notional (L0-14).
    /// 0/absent = no absolute bound (bps-only, today's behavior). The
    /// anti-TVL-scaling backstop: effective cap = min(bps×AUM, this).
    AssetCapAbs(Symbol),
    /// Per-asset net-skew cap as bps of AUM (L0-14; default 1500 = 15%).
    SkewCapBps(Symbol),
    /// L0-15 timelocked recovery: the ONE pre-declared break-glass
    /// destination (set once via init_recovery; changing it needs upgrade()).
    RecoveryAddress,
    /// L0-15 open recovery proposal (amount, execute_after) in (7-dec, secs).
    /// Absent = none pending.
    RecoveryProposal,
    /// L1-28: ledger-seconds of an address's LATEST deposit (unwrap_or 0).
    /// Every deposit re-arms the withdraw cooldown; 0 = never deposited
    /// post-upgrade (exempt — clean migration, no backfill).
    LastDepositTs(Address),
    /// L1-28: withdraw cooldown window in seconds (instance, unwrap_or 1_800).
    /// 0 disables.
    WithdrawCooldownSecs,
}

/// Default LP withdraw cooldown after each deposit (L1-28): 30 min.
pub const WITHDRAW_COOLDOWN_SECS_DEFAULT: u64 = 1_800;

pub const RESERVE_CAP_BPS_DEFAULT: u32 = 7_000;
pub const ASSET_CAP_BPS_DEFAULT: u32 = 2_500;
pub const SKEW_CAP_BPS_DEFAULT: u32 = 1_500;

// ═══════════════════════════════════════════════════════════════════════════
// Instance Storage (Contract State)
// ═══════════════════════════════════════════════════════════════════════════

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

pub fn set_initialized(env: &Env, value: bool) {
    env.storage().instance().set(&DataKey::Initialized, &value);
}

pub fn get_paused(env: &Env) -> bool {
    env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
}

pub fn set_paused(env: &Env, value: bool) {
    env.storage().instance().set(&DataKey::Paused, &value);
}

// ── L0-15 timelocked recovery ──
pub fn get_recovery_address(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::RecoveryAddress)
}

pub fn set_recovery_address(env: &Env, addr: &Address) {
    env.storage().instance().set(&DataKey::RecoveryAddress, addr);
}

pub fn get_recovery_proposal(env: &Env) -> Option<(i128, u64)> {
    env.storage().instance().get(&DataKey::RecoveryProposal)
}

pub fn set_recovery_proposal(env: &Env, amount: i128, execute_after: u64) {
    env.storage().instance().set(&DataKey::RecoveryProposal, &(amount, execute_after));
}

pub fn clear_recovery_proposal(env: &Env) {
    env.storage().instance().remove(&DataKey::RecoveryProposal);
}

// ── L1-28 withdraw cooldown ──
pub fn get_last_deposit_ts(env: &Env, who: &Address) -> u64 {
    env.storage().persistent().get(&DataKey::LastDepositTs(who.clone())).unwrap_or(0)
}

pub fn set_last_deposit_ts(env: &Env, who: &Address, ts: u64) {
    let key = DataKey::LastDepositTs(who.clone());
    env.storage().persistent().set(&key, &ts);
    extend_ttl(env, &key);
}

pub fn get_withdraw_cooldown_secs(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::WithdrawCooldownSecs)
        .unwrap_or(WITHDRAW_COOLDOWN_SECS_DEFAULT)
}

pub fn set_withdraw_cooldown_secs(env: &Env, secs: u64) {
    env.storage().instance().set(&DataKey::WithdrawCooldownSecs, &secs);
}

pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_usdc_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::UsdcToken).unwrap()
}

pub fn set_usdc_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::UsdcToken, token);
}

pub fn get_market_contract(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::MarketContract).unwrap()
}

pub fn set_market_contract(env: &Env, market: &Address) {
    env.storage().instance().set(&DataKey::MarketContract, market);
}

pub fn get_noe_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::NoeToken).unwrap()
}

pub fn set_noe_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::NoeToken, token);
}

pub fn get_deposit_fee_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::DepositFeeBps).unwrap_or(30) // 0.3% default
}

pub fn set_deposit_fee_bps(env: &Env, fee: u32) {
    env.storage().instance().set(&DataKey::DepositFeeBps, &fee);
}

pub fn get_withdraw_fee_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::WithdrawFeeBps).unwrap_or(30) // 0.3% default
}

pub fn set_withdraw_fee_bps(env: &Env, fee: u32) {
    env.storage().instance().set(&DataKey::WithdrawFeeBps, &fee);
}

// ═══════════════════════════════════════════════════════════════════════════
// Persistent Storage (Pool State)
// ═══════════════════════════════════════════════════════════════════════════

pub fn get_total_usdc(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::TotalUsdc).unwrap_or(0)
}

pub fn set_total_usdc(env: &Env, amount: i128) {
    env.storage().persistent().set(&DataKey::TotalUsdc, &amount);
    env.storage().persistent().extend_ttl(&DataKey::TotalUsdc, TTL_THRESHOLD, TTL_EXTEND_TO);
}

pub fn get_total_noe_circulating(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::TotalNoeCirculating).unwrap_or(0)
}

pub fn set_total_noe_circulating(env: &Env, amount: i128) {
    env.storage().persistent().set(&DataKey::TotalNoeCirculating, &amount);
    env.storage().persistent().extend_ttl(&DataKey::TotalNoeCirculating, TTL_THRESHOLD, TTL_EXTEND_TO);
}

pub fn get_unrealized_pnl(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::UnrealizedPnl).unwrap_or(0)
}

pub fn set_unrealized_pnl(env: &Env, amount: i128) {
    env.storage().persistent().set(&DataKey::UnrealizedPnl, &amount);
    env.storage().persistent().extend_ttl(&DataKey::UnrealizedPnl, TTL_THRESHOLD, TTL_EXTEND_TO);
}

pub fn get_reserved_payout(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::ReservedPayout).unwrap_or(0)
}

pub fn set_reserved_payout(env: &Env, amount: i128) {
    env.storage().persistent().set(&DataKey::ReservedPayout, &amount);
    extend_ttl(env, &DataKey::ReservedPayout);
}

pub fn get_shortfall(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::Shortfall).unwrap_or(0)
}

pub fn set_shortfall(env: &Env, amount: i128) {
    env.storage().persistent().set(&DataKey::Shortfall, &amount);
    extend_ttl(env, &DataKey::Shortfall);
}

pub fn get_buffer_balance(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::BufferBalance).unwrap_or(0)
}

pub fn set_buffer_balance(env: &Env, amount: i128) {
    env.storage().persistent().set(&DataKey::BufferBalance, &amount);
    extend_ttl(env, &DataKey::BufferBalance);
}

pub fn get_shortfall_owed(env: &Env, who: &Address) -> i128 {
    env.storage().persistent().get(&DataKey::ShortfallOwed(who.clone())).unwrap_or(0)
}

pub fn set_shortfall_owed(env: &Env, who: &Address, amount: i128) {
    let key = DataKey::ShortfallOwed(who.clone());
    env.storage().persistent().set(&key, &amount);
    extend_ttl(env, &key);
}

pub fn get_shortfall_reserve(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::ShortfallReserve).unwrap_or(0)
}

pub fn set_shortfall_reserve(env: &Env, amount: i128) {
    env.storage().persistent().set(&DataKey::ShortfallReserve, &amount);
    extend_ttl(env, &DataKey::ShortfallReserve);
}

pub fn get_cum_shortfall(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::CumShortfall).unwrap_or(0)
}

pub fn set_cum_shortfall(env: &Env, amount: i128) {
    env.storage().persistent().set(&DataKey::CumShortfall, &amount);
    extend_ttl(env, &DataKey::CumShortfall);
}

pub fn get_cum_shortfall_repaid(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::CumShortfallRepaid).unwrap_or(0)
}

pub fn set_cum_shortfall_repaid(env: &Env, amount: i128) {
    env.storage().persistent().set(&DataKey::CumShortfallRepaid, &amount);
    extend_ttl(env, &DataKey::CumShortfallRepaid);
}

pub fn get_cum_bad_debt_covered(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::CumBadDebtCovered).unwrap_or(0)
}

pub fn set_cum_bad_debt_covered(env: &Env, amount: i128) {
    env.storage().persistent().set(&DataKey::CumBadDebtCovered, &amount);
    extend_ttl(env, &DataKey::CumBadDebtCovered);
}

pub fn get_cum_bad_debt_lp_absorbed(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::CumBadDebtLpAbsorbed).unwrap_or(0)
}

pub fn set_cum_bad_debt_lp_absorbed(env: &Env, amount: i128) {
    env.storage().persistent().set(&DataKey::CumBadDebtLpAbsorbed, &amount);
    extend_ttl(env, &DataKey::CumBadDebtLpAbsorbed);
}

pub fn get_shortfall_inflow_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::ShortfallInflowBps).unwrap_or(5_000)
}

pub fn set_shortfall_inflow_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&DataKey::ShortfallInflowBps, &bps);
}

pub fn get_deposited(env: &Env, who: &Address) -> i128 {
    env.storage().persistent().get(&DataKey::Deposited(who.clone())).unwrap_or(0)
}

pub fn set_deposited(env: &Env, who: &Address, amount: i128) {
    let key = DataKey::Deposited(who.clone());
    env.storage().persistent().set(&key, &amount);
    extend_ttl(env, &key);
}

/// Per-account cumulative-deposit cap (7 decimals). 0 = unlimited (default,
/// off — the guarded-launch mainnet config sets it via set_deposit_cap).
pub fn get_deposit_cap(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::DepositCap).unwrap_or(0)
}

pub fn set_deposit_cap(env: &Env, cap: i128) {
    env.storage().instance().set(&DataKey::DepositCap, &cap);
}

// ── L1-22 insurance-buffer target ──
/// Default buffer target: 10% of ReservedPayout.
pub const BUFFER_TARGET_BPS_DEFAULT: u32 = 1_000;

pub fn get_buffer_target_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::BufferTargetBps).unwrap_or(BUFFER_TARGET_BPS_DEFAULT)
}

pub fn set_buffer_target_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&DataKey::BufferTargetBps, &bps);
}

pub fn get_reserve_cap_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::ReserveCapBps).unwrap_or(RESERVE_CAP_BPS_DEFAULT)
}

pub fn set_reserve_cap_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&DataKey::ReserveCapBps, &bps);
}

pub fn get_asset_cap_bps(env: &Env, asset: &Symbol) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::AssetCapBps(asset.clone()))
        .unwrap_or(ASSET_CAP_BPS_DEFAULT)
}

pub fn set_asset_cap_bps(env: &Env, asset: &Symbol, bps: u32) {
    let key = DataKey::AssetCapBps(asset.clone());
    env.storage().persistent().set(&key, &bps);
    extend_ttl(env, &key);
}

pub fn get_asset_cap_abs(env: &Env, asset: &Symbol) -> i128 {
    env.storage().persistent().get(&DataKey::AssetCapAbs(asset.clone())).unwrap_or(0)
}

pub fn set_asset_cap_abs(env: &Env, asset: &Symbol, max_notional: i128) {
    let key = DataKey::AssetCapAbs(asset.clone());
    env.storage().persistent().set(&key, &max_notional);
    extend_ttl(env, &key);
}

pub fn get_skew_cap_bps(env: &Env, asset: &Symbol) -> u32 {
    env.storage().persistent().get(&DataKey::SkewCapBps(asset.clone())).unwrap_or(SKEW_CAP_BPS_DEFAULT)
}

pub fn set_skew_cap_bps(env: &Env, asset: &Symbol, bps: u32) {
    let key = DataKey::SkewCapBps(asset.clone());
    env.storage().persistent().set(&key, &bps);
    extend_ttl(env, &key);
}

pub fn get_asset_unrealized_pnl(env: &Env, asset: &Symbol) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::AssetUnrealizedPnl(asset.clone()))
        .unwrap_or(0)
}

pub fn set_asset_unrealized_pnl(env: &Env, asset: &Symbol, pnl: i128) {
    let key = DataKey::AssetUnrealizedPnl(asset.clone());
    env.storage().persistent().set(&key, &pnl);
    extend_ttl(env, &key);
}

pub fn get_total_fees(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::TotalFees).unwrap_or(0)
}

pub fn set_total_fees(env: &Env, amount: i128) {
    env.storage().persistent().set(&DataKey::TotalFees, &amount);
    env.storage().persistent().extend_ttl(&DataKey::TotalFees, TTL_THRESHOLD, TTL_EXTEND_TO);
}

// ═══════════════════════════════════════════════════════════════════════════
// Authorization Helpers
// ═══════════════════════════════════════════════════════════════════════════

pub fn require_initialized(env: &Env) -> Result<(), NoetherError> {
    if !is_initialized(env) {
        return Err(NoetherError::NotInitialized);
    }
    // R-1: every live call re-arms the instance rent (no-op above the
    // threshold), so an actively-used contract can never archive.
    extend_instance_ttl(env);
    Ok(())
}

pub fn require_not_paused(env: &Env) -> Result<(), NoetherError> {
    if get_paused(env) {
        return Err(NoetherError::Paused);
    }
    Ok(())
}

pub fn require_admin(env: &Env) -> Result<(), NoetherError> {
    require_initialized(env)?;
    let admin = get_admin(env);
    admin.require_auth();
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════
// TTL Management
// ═══════════════════════════════════════════════════════════════════════════

/// Extend TTL for instance storage (30 days).
pub fn extend_instance_ttl(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn extend_ttl(env: &Env, key: &DataKey) {
    env.storage().persistent().extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
}
