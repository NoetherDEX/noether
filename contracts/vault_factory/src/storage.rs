//! Storage helpers for the vault factory.
//!
//! All keys are namespaced by `StorageKey`. Singletons live in
//! instance storage; per-vault and per-depositor rows live in
//! persistent storage.

use soroban_sdk::{Address, Env, Vec};

use crate::types::{FactoryError, MAX_OPEN_PER_VAULT, StorageKey, VaultInfo};

use noether_common::ttl::{TTL_EXTEND_TO, TTL_THRESHOLD};
const INSTANCE_TTL_THRESHOLD: u32 = TTL_THRESHOLD;
const INSTANCE_TTL_EXTEND: u32 = TTL_EXTEND_TO;
const PERSISTENT_TTL_THRESHOLD: u32 = TTL_THRESHOLD;
const PERSISTENT_TTL_EXTEND: u32 = TTL_EXTEND_TO;

// ───────────────────────────────────────────────────────────────────────
// Initialization
// ───────────────────────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&StorageKey::Initialized)
        .unwrap_or(false)
}

pub fn require_initialized(env: &Env) -> Result<(), FactoryError> {
    if !is_initialized(env) {
        return Err(FactoryError::NotInitialized);
    }
    // R-1: every live call re-arms the instance rent (no-op above the
    // threshold), so an actively-used contract can never archive.
    extend_instance_ttl(env);
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
// Singletons (admin / market / usdc / id counter)
// ───────────────────────────────────────────────────────────────────────

pub fn set_admin(env: &Env, addr: &Address) {
    env.storage().instance().set(&StorageKey::Admin, addr);
}

pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&StorageKey::Admin)
        .expect("admin not set; was initialize() called?")
}

pub fn require_admin(env: &Env) -> Result<(), FactoryError> {
    require_initialized(env)?;
    let admin = get_admin(env);
    admin.require_auth();
    Ok(())
}

pub fn set_market(env: &Env, addr: &Address) {
    env.storage().instance().set(&StorageKey::Market, addr);
}

pub fn get_market(env: &Env) -> Address {
    env.storage().instance().get(&StorageKey::Market).expect("market not set")
}

pub fn set_usdc(env: &Env, addr: &Address) {
    env.storage().instance().set(&StorageKey::Usdc, addr);
}

pub fn get_usdc(env: &Env) -> Address {
    env.storage().instance().get(&StorageKey::Usdc).expect("usdc not set")
}

pub fn next_vault_id(env: &Env) -> u32 {
    let current: u32 = env
        .storage()
        .instance()
        .get(&StorageKey::NextVaultId)
        .unwrap_or(0);
    let next = current.checked_add(1).expect("vault id overflow");
    env.storage().instance().set(&StorageKey::NextVaultId, &next);
    current
}

// ───────────────────────────────────────────────────────────────────────
// Vault rows
// ───────────────────────────────────────────────────────────────────────

pub fn save_vault(env: &Env, info: &VaultInfo) {
    let key = StorageKey::Vault(info.id);
    env.storage().persistent().set(&key, info);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
}

pub fn load_vault(env: &Env, vault_id: u32) -> Result<VaultInfo, FactoryError> {
    env.storage()
        .persistent()
        .get(&StorageKey::Vault(vault_id))
        .ok_or(FactoryError::VaultNotFound)
}


// ───────────────────────────────────────────────────────────────────────
// Depositor share balances
// ───────────────────────────────────────────────────────────────────────

pub fn shares_of(env: &Env, vault_id: u32, depositor: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&StorageKey::Shares(vault_id, depositor.clone()))
        .unwrap_or(0)
}

pub fn set_shares(env: &Env, vault_id: u32, depositor: &Address, amount: i128) {
    let key = StorageKey::Shares(vault_id, depositor.clone());
    if amount == 0 {
        env.storage().persistent().remove(&key);
    } else {
        env.storage().persistent().set(&key, &amount);
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
    }
}

// ───────────────────────────────────────────────────────────────────────
// Vault list (for enumeration / marketplace)
// ───────────────────────────────────────────────────────────────────────

pub fn append_vault_list(env: &Env, id: u32) {
    let mut list: Vec<u32> = env
        .storage()
        .persistent()
        .get(&StorageKey::VaultList)
        .unwrap_or_else(|| Vec::new(env));
    list.push_back(id);
    env.storage().persistent().set(&StorageKey::VaultList, &list);
    env.storage().persistent().extend_ttl(
        &StorageKey::VaultList,
        PERSISTENT_TTL_THRESHOLD,
        PERSISTENT_TTL_EXTEND,
    );
}

pub fn get_vault_list(env: &Env) -> Vec<u32> {
    env.storage()
        .persistent()
        .get(&StorageKey::VaultList)
        .unwrap_or_else(|| Vec::new(env))
}

// ───────────────────────────────────────────────────────────────────────
// L0-20: position/order → vault ownership maps + per-vault open lists
// ───────────────────────────────────────────────────────────────────────

pub fn get_position_vault(env: &Env, position_id: u64) -> Option<u32> {
    env.storage().persistent().get(&StorageKey::PositionVault(position_id))
}

pub fn set_position_vault(env: &Env, position_id: u64, vault_id: u32) {
    let key = StorageKey::PositionVault(position_id);
    env.storage().persistent().set(&key, &vault_id);
    env.storage().persistent().extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
}

pub fn remove_position_vault(env: &Env, position_id: u64) {
    env.storage().persistent().remove(&StorageKey::PositionVault(position_id));
}

pub fn get_order_vault(env: &Env, order_id: u64) -> Option<u32> {
    env.storage().persistent().get(&StorageKey::OrderVault(order_id))
}

pub fn set_order_vault(env: &Env, order_id: u64, vault_id: u32) {
    let key = StorageKey::OrderVault(order_id);
    env.storage().persistent().set(&key, &vault_id);
    env.storage().persistent().extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
}

pub fn remove_order_vault(env: &Env, order_id: u64) {
    env.storage().persistent().remove(&StorageKey::OrderVault(order_id));
}

pub fn get_vault_positions(env: &Env, vault_id: u32) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&StorageKey::VaultPositions(vault_id))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn get_vault_orders(env: &Env, vault_id: u32) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&StorageKey::VaultOrders(vault_id))
        .unwrap_or_else(|| Vec::new(env))
}

/// Total open slots (positions + pending orders) a vault currently holds.
fn open_slot_count(env: &Env, vault_id: u32) -> u32 {
    get_vault_positions(env, vault_id).len() + get_vault_orders(env, vault_id).len()
}

pub fn push_vault_position(env: &Env, vault_id: u32, position_id: u64) -> Result<(), FactoryError> {
    if open_slot_count(env, vault_id) >= MAX_OPEN_PER_VAULT {
        return Err(FactoryError::TooManyOpenSlots);
    }
    let key = StorageKey::VaultPositions(vault_id);
    let mut list = get_vault_positions(env, vault_id);
    list.push_back(position_id);
    env.storage().persistent().set(&key, &list);
    env.storage().persistent().extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
    Ok(())
}

pub fn remove_vault_position(env: &Env, vault_id: u32, position_id: u64) {
    let key = StorageKey::VaultPositions(vault_id);
    let list = get_vault_positions(env, vault_id);
    let mut next: Vec<u64> = Vec::new(env);
    for i in 0..list.len() {
        let id = list.get(i).unwrap();
        if id != position_id {
            next.push_back(id);
        }
    }
    env.storage().persistent().set(&key, &next);
    env.storage().persistent().extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
}

pub fn push_vault_order(env: &Env, vault_id: u32, order_id: u64) -> Result<(), FactoryError> {
    if open_slot_count(env, vault_id) >= MAX_OPEN_PER_VAULT {
        return Err(FactoryError::TooManyOpenSlots);
    }
    let key = StorageKey::VaultOrders(vault_id);
    let mut list = get_vault_orders(env, vault_id);
    list.push_back(order_id);
    env.storage().persistent().set(&key, &list);
    env.storage().persistent().extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
    Ok(())
}

pub fn remove_vault_order(env: &Env, vault_id: u32, order_id: u64) {
    let key = StorageKey::VaultOrders(vault_id);
    let list = get_vault_orders(env, vault_id);
    let mut next: Vec<u64> = Vec::new(env);
    for i in 0..list.len() {
        let id = list.get(i).unwrap();
        if id != order_id {
            next.push_back(id);
        }
    }
    env.storage().persistent().set(&key, &next);
    env.storage().persistent().extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
}

// ───────────────────────────────────────────────────────────────────────
// L0-20: leader allowlist + max-active-vaults gate (instance)
// ───────────────────────────────────────────────────────────────────────

pub fn get_leader_allowlist(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&StorageKey::LeaderAllowlist)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_leader_allowlist(env: &Env, list: &Vec<Address>) {
    env.storage().instance().set(&StorageKey::LeaderAllowlist, list);
}

pub fn get_max_vaults(env: &Env) -> u32 {
    env.storage().instance().get(&StorageKey::MaxActiveVaults).unwrap_or(0)
}

pub fn set_max_vaults(env: &Env, max: u32) {
    env.storage().instance().set(&StorageKey::MaxActiveVaults, &max);
}
