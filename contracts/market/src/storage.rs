//! # Market Storage
//!
//! Storage keys and helpers for the Market contract.

use soroban_sdk::{contracttype, Address, Env, Vec};
use noether_common::{NoetherError, Position, MarketConfig};

// ═══════════════════════════════════════════════════════════════════════════
// Storage Keys
// ═══════════════════════════════════════════════════════════════════════════

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Admin address
    Admin,
    /// Oracle adapter contract address
    OracleAdapter,
    /// Vault contract address
    Vault,
    /// USDC token contract address
    UsdcToken,
    /// Market configuration
    Config,
    /// Position counter (for ID generation)
    PositionCounter,
    /// Total long position size
    TotalLongSize,
    /// Total short position size
    TotalShortSize,
    /// Last funding time
    LastFundingTime,
    /// Current funding rate
    CurrentFundingRate,
    /// Whether initialized
    Initialized,
    /// Whether paused
    Paused,
    /// Position by ID
    Position(u64),
    /// Position IDs for a trader
    TraderPositions(Address),
    /// Global position index (all position IDs)
    AllPositions,
}

// ═══════════════════════════════════════════════════════════════════════════
// Instance Storage
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

pub fn get_oracle_adapter(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::OracleAdapter).unwrap()
}

pub fn set_oracle_adapter(env: &Env, oracle: &Address) {
    env.storage().instance().set(&DataKey::OracleAdapter, oracle);
}

pub fn get_vault(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Vault).unwrap()
}

pub fn set_vault(env: &Env, vault: &Address) {
    env.storage().instance().set(&DataKey::Vault, vault);
}

pub fn get_usdc_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::UsdcToken).unwrap()
}

pub fn set_usdc_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::UsdcToken, token);
}

pub fn get_config(env: &Env) -> MarketConfig {
    env.storage().instance().get(&DataKey::Config).unwrap_or_default()
}

pub fn set_config(env: &Env, config: &MarketConfig) {
    env.storage().instance().set(&DataKey::Config, config);
}

// ═══════════════════════════════════════════════════════════════════════════
// Persistent Storage - Market State
// ═══════════════════════════════════════════════════════════════════════════

pub fn get_position_counter(env: &Env) -> u64 {
    env.storage().persistent().get(&DataKey::PositionCounter).unwrap_or(0)
}

pub fn set_position_counter(env: &Env, counter: u64) {
    env.storage().persistent().set(&DataKey::PositionCounter, &counter);
    extend_persistent_ttl(env, &DataKey::PositionCounter);
}

pub fn next_position_id(env: &Env) -> u64 {
    let counter = get_position_counter(env);
    let next_id = counter + 1;
    set_position_counter(env, next_id);
    next_id
}

pub fn get_total_long_size(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::TotalLongSize).unwrap_or(0)
}

pub fn set_total_long_size(env: &Env, size: i128) {
    env.storage().persistent().set(&DataKey::TotalLongSize, &size);
    extend_persistent_ttl(env, &DataKey::TotalLongSize);
}

pub fn get_total_short_size(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::TotalShortSize).unwrap_or(0)
}

pub fn set_total_short_size(env: &Env, size: i128) {
    env.storage().persistent().set(&DataKey::TotalShortSize, &size);
    extend_persistent_ttl(env, &DataKey::TotalShortSize);
}

pub fn get_last_funding_time(env: &Env) -> u64 {
    env.storage().persistent().get(&DataKey::LastFundingTime).unwrap_or(0)
}

pub fn set_last_funding_time(env: &Env, time: u64) {
    env.storage().persistent().set(&DataKey::LastFundingTime, &time);
    extend_persistent_ttl(env, &DataKey::LastFundingTime);
}

pub fn get_current_funding_rate(env: &Env) -> i128 {
    env.storage().persistent().get(&DataKey::CurrentFundingRate).unwrap_or(0)
}

pub fn set_current_funding_rate(env: &Env, rate: i128) {
    env.storage().persistent().set(&DataKey::CurrentFundingRate, &rate);
    extend_persistent_ttl(env, &DataKey::CurrentFundingRate);
}

// ═══════════════════════════════════════════════════════════════════════════
// Position Storage
// ═══════════════════════════════════════════════════════════════════════════

pub fn get_position(env: &Env, id: u64) -> Option<Position> {
    env.storage().persistent().get(&DataKey::Position(id))
}

pub fn save_position(env: &Env, position: &Position) {
    // Save position
    env.storage().persistent().set(&DataKey::Position(position.id), position);
    extend_persistent_ttl(env, &DataKey::Position(position.id));

    // Add to trader's position list
    let trader_key = DataKey::TraderPositions(position.trader.clone());
    let mut trader_positions: Vec<u64> = env.storage()
        .persistent()
        .get(&trader_key)
        .unwrap_or(Vec::new(env));

    // Only add if not already in list
    let mut found = false;
    for i in 0..trader_positions.len() {
        if trader_positions.get(i).unwrap() == position.id {
            found = true;
            break;
        }
    }
    if !found {
        trader_positions.push_back(position.id);
        env.storage().persistent().set(&trader_key, &trader_positions);
        extend_persistent_ttl(env, &trader_key);
    }

    // Add to global position index
    let mut all_positions = get_all_position_ids(env);
    let mut found_global = false;
    for i in 0..all_positions.len() {
        if all_positions.get(i).unwrap() == position.id {
            found_global = true;
            break;
        }
    }
    if !found_global {
        all_positions.push_back(position.id);
        env.storage().persistent().set(&DataKey::AllPositions, &all_positions);
        extend_persistent_ttl(env, &DataKey::AllPositions);
    }
}

pub fn delete_position(env: &Env, id: u64, trader: &Address) {
    // Remove from storage
    env.storage().persistent().remove(&DataKey::Position(id));

    // Remove from trader's list
    let trader_key = DataKey::TraderPositions(trader.clone());
    let trader_positions: Vec<u64> = env.storage()
        .persistent()
        .get(&trader_key)
        .unwrap_or(Vec::new(env));

    let mut new_list = Vec::new(env);
    for i in 0..trader_positions.len() {
        let pos_id = trader_positions.get(i).unwrap();
        if pos_id != id {
            new_list.push_back(pos_id);
        }
    }
    env.storage().persistent().set(&trader_key, &new_list);

    // Remove from global index
    let all_positions = get_all_position_ids(env);
    let mut new_all = Vec::new(env);
    for i in 0..all_positions.len() {
        let pos_id = all_positions.get(i).unwrap();
        if pos_id != id {
            new_all.push_back(pos_id);
        }
    }
    env.storage().persistent().set(&DataKey::AllPositions, &new_all);
}

pub fn get_trader_positions(env: &Env, trader: &Address) -> Vec<Position> {
    let trader_key = DataKey::TraderPositions(trader.clone());
    let position_ids: Vec<u64> = env.storage()
        .persistent()
        .get(&trader_key)
        .unwrap_or(Vec::new(env));

    let mut positions = Vec::new(env);
    for i in 0..position_ids.len() {
        let id = position_ids.get(i).unwrap();
        if let Some(pos) = get_position(env, id) {
            positions.push_back(pos);
        }
    }
    positions
}

pub fn init_position_index(env: &Env) {
    let empty: Vec<u64> = Vec::new(env);
    env.storage().persistent().set(&DataKey::AllPositions, &empty);
}

pub fn get_all_position_ids(env: &Env) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::AllPositions)
        .unwrap_or(Vec::new(env))
}

pub fn get_position_count(env: &Env) -> u64 {
    get_all_position_ids(env).len() as u64
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

pub fn extend_instance_ttl(env: &Env) {
    env.storage().instance().extend_ttl(2_592_000, 2_592_000); // 30 days
}

fn extend_persistent_ttl(env: &Env, key: &DataKey) {
    env.storage().persistent().extend_ttl(key, 2_592_000, 2_592_000);
}
