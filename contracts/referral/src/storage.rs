use soroban_sdk::{Address, Env, String};

use crate::types::{ReferralError, ReferralInfo, StorageKey};

use noether_common::ttl::{TTL_EXTEND_TO, TTL_THRESHOLD};
const INSTANCE_TTL_THRESHOLD: u32 = TTL_THRESHOLD;
const INSTANCE_TTL_EXTEND: u32 = TTL_EXTEND_TO;
const PERSISTENT_TTL_THRESHOLD: u32 = TTL_THRESHOLD;
const PERSISTENT_TTL_EXTEND: u32 = TTL_EXTEND_TO;

pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&StorageKey::Initialized)
        .unwrap_or(false)
}

pub fn require_initialized(env: &Env) -> Result<(), ReferralError> {
    if !is_initialized(env) {
        return Err(ReferralError::NotInitialized);
    }
    Ok(())
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&StorageKey::Initialized, &true);
}

pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND);
}

// ───────────────────────────────────────────────────────────────────────
// Singletons
// ───────────────────────────────────────────────────────────────────────

pub fn set_admin(env: &Env, addr: &Address) {
    env.storage().instance().set(&StorageKey::Admin, addr);
}

pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&StorageKey::Admin).expect("admin not set")
}

pub fn require_admin(env: &Env) -> Result<(), ReferralError> {
    require_initialized(env)?;
    get_admin(env).require_auth();
    Ok(())
}

pub fn set_market(env: &Env, addr: &Address) {
    env.storage().instance().set(&StorageKey::Market, addr);
}

pub fn get_market(env: &Env) -> Address {
    env.storage().instance().get(&StorageKey::Market).expect("market not set")
}

pub fn require_market(env: &Env) -> Result<(), ReferralError> {
    require_initialized(env)?;
    get_market(env).require_auth();
    Ok(())
}

pub fn set_discount_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&StorageKey::DiscountBps, &bps);
}

pub fn get_discount_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&StorageKey::DiscountBps)
        .unwrap_or(0)
}

pub fn set_referrer_share_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&StorageKey::ReferrerShareBps, &bps);
}

pub fn get_referrer_share_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&StorageKey::ReferrerShareBps)
        .unwrap_or(0)
}

pub fn set_usdc_token(env: &Env, addr: &Address) {
    env.storage().instance().set(&StorageKey::UsdcToken, addr);
}

pub fn get_usdc_token(env: &Env) -> Option<Address> {
    env.storage().instance().get(&StorageKey::UsdcToken)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&StorageKey::Paused, &paused);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&StorageKey::Paused)
        .unwrap_or(false)
}

pub fn set_revoked(env: &Env, referrer: &Address, revoked: bool) {
    let key = StorageKey::Revoked(referrer.clone());
    if revoked {
        env.storage().persistent().set(&key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
    } else {
        env.storage().persistent().remove(&key);
    }
}

pub fn is_revoked(env: &Env, referrer: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&StorageKey::Revoked(referrer.clone()))
        .unwrap_or(false)
}

pub fn remove_referrer_of(env: &Env, referee: &Address) {
    env.storage()
        .persistent()
        .remove(&StorageKey::RefereeOf(referee.clone()));
}

pub fn set_min_code_volume(env: &Env, volume: i128) {
    env.storage().instance().set(&StorageKey::MinCodeVolume, &volume);
}

pub fn get_min_code_volume(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&StorageKey::MinCodeVolume)
        .unwrap_or(0)
}

// ───────────────────────────────────────────────────────────────────────
// Code → referrer mapping
// ───────────────────────────────────────────────────────────────────────

pub fn code_taken(env: &Env, code: &String) -> bool {
    env.storage().persistent().has(&StorageKey::Code(code.clone()))
}

pub fn assign_code(env: &Env, code: &String, referrer: &Address) {
    let key = StorageKey::Code(code.clone());
    env.storage().persistent().set(&key, referrer);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
}

pub fn lookup_code(env: &Env, code: &String) -> Option<Address> {
    env.storage().persistent().get(&StorageKey::Code(code.clone()))
}

// ───────────────────────────────────────────────────────────────────────
// Referrer info rows
// ───────────────────────────────────────────────────────────────────────

pub fn save_info(env: &Env, info: &ReferralInfo) {
    let key = StorageKey::Info(info.referrer.clone());
    env.storage().persistent().set(&key, info);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
}

pub fn load_info(env: &Env, referrer: &Address) -> Option<ReferralInfo> {
    env.storage()
        .persistent()
        .get(&StorageKey::Info(referrer.clone()))
}

// ───────────────────────────────────────────────────────────────────────
// Referee → referrer mapping
// ───────────────────────────────────────────────────────────────────────

pub fn referrer_of(env: &Env, referee: &Address) -> Option<Address> {
    env.storage()
        .persistent()
        .get(&StorageKey::RefereeOf(referee.clone()))
}

pub fn set_referrer_of(env: &Env, referee: &Address, referrer: &Address) {
    let key = StorageKey::RefereeOf(referee.clone());
    env.storage().persistent().set(&key, referrer);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
}
