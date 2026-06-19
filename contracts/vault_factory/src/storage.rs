//! Storage helpers for the vault factory.
//!
//! All keys are namespaced by `StorageKey`. Singletons live in
//! instance storage; per-vault and per-depositor rows live in
//! persistent storage.

use soroban_sdk::{Address, Env, Vec};

use crate::types::{FactoryError, StorageKey, VaultInfo};
use noether_common::{TTL_THRESHOLD, TTL_EXTEND_TO};

// Sourced from the shared constants in noether_common (V-6) so every contract
// bumps storage TTL identically.
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

pub fn vault_exists(env: &Env, vault_id: u32) -> bool {
    env.storage().persistent().has(&StorageKey::Vault(vault_id))
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
