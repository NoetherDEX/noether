//! # Vault Storage
//!
//! Storage keys and helper functions for the Vault contract.

use soroban_sdk::{contracttype, Address, Env};
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
}

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
    env.storage().persistent().extend_ttl(&DataKey::TotalUsdc, 2_592_000, 2_592_000);
}

pub fn get_total_noe_circulating(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::TotalNoeCirculating).unwrap_or(0)
}

pub fn set_total_noe_circulating(env: &Env, amount: i128) {
    env.storage().persistent().set(&DataKey::TotalNoeCirculating, &amount);
    env.storage().persistent().extend_ttl(&DataKey::TotalNoeCirculating, 2_592_000, 2_592_000);
}

pub fn get_unrealized_pnl(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::UnrealizedPnl).unwrap_or(0)
}

pub fn set_unrealized_pnl(env: &Env, amount: i128) {
    env.storage().persistent().set(&DataKey::UnrealizedPnl, &amount);
    env.storage().persistent().extend_ttl(&DataKey::UnrealizedPnl, 2_592_000, 2_592_000);
}

pub fn get_total_fees(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::TotalFees).unwrap_or(0)
}

pub fn set_total_fees(env: &Env, amount: i128) {
    env.storage().persistent().set(&DataKey::TotalFees, &amount);
    env.storage().persistent().extend_ttl(&DataKey::TotalFees, 2_592_000, 2_592_000);
}

// ═══════════════════════════════════════════════════════════════════════════
// Authorization Helpers
// ═══════════════════════════════════════════════════════════════════════════

pub fn require_initialized(env: &Env) -> Result<(), NoetherError> {
    if !is_initialized(env) {
        return Err(NoetherError::NotInitialized);
    }
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
    env.storage().instance().extend_ttl(2_592_000, 2_592_000);
}
