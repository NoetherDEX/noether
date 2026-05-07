//! # Vault Factory Contract
//!
//! Tranche 2 deliverable D3 — user-created trading vaults.
//!
//! Any address can call `create_vault(leader, name)` to mint a new
//! vault. Depositors send USDC to the vault and receive proportional
//! "shares". The leader trades on behalf of all depositors using the
//! shared collateral and earns a 10% profit share above the
//! high-water mark. The leader is required to keep at least 5% of
//! their own capital in the vault at all times.
//!
//! Phase 10.1 — crate scaffold only. Public surface lands across
//! subsequent commits in this branch.

#![no_std]

use soroban_sdk::{contract, contractimpl, Address, Env, String, Symbol, Vec};

mod math;
mod storage;
mod types;

pub use types::{FactoryError, VaultInfo, DEFAULT_PROFIT_SHARE_BPS, MAX_PROFIT_SHARE_BPS, PRECISION};

#[contract]
pub struct VaultFactoryContract;

#[contractimpl]
impl VaultFactoryContract {
    /// Sentinel string so off-chain tooling can probe a deployed
    /// contract for its phase tag without parsing arbitrary state.
    pub fn version(env: Env) -> Symbol {
        Symbol::new(&env, "vault_factory_v0")
    }

    /// One-shot initialisation. Wires the factory to the protocol's
    /// market + USDC contracts and pins an admin address that can
    /// pause the factory globally.
    pub fn initialize(
        env: Env,
        admin: Address,
        market: Address,
        usdc: Address,
    ) -> Result<(), FactoryError> {
        if storage::is_initialized(&env) {
            return Err(FactoryError::AlreadyInitialized);
        }
        admin.require_auth();
        storage::set_admin(&env, &admin);
        storage::set_market(&env, &market);
        storage::set_usdc(&env, &usdc);
        storage::set_initialized(&env);
        storage::extend_instance_ttl(&env);
        env.events()
            .publish((Symbol::new(&env, "initialized"),), (admin, market, usdc));
        Ok(())
    }

    /// Create a fresh vault. The caller is bound as the leader; the
    /// vault starts empty (zero deposits, zero shares, NAV = 1.0,
    /// HWM = 1.0, profit share = 10%).
    pub fn create_vault(
        env: Env,
        leader: Address,
        name: String,
    ) -> Result<u32, FactoryError> {
        storage::require_initialized(&env)?;
        leader.require_auth();
        if name.len() == 0 || name.len() > 64 {
            return Err(FactoryError::InvalidName);
        }
        let id = storage::next_vault_id(&env);
        let info = VaultInfo {
            id,
            leader: leader.clone(),
            name: name.clone(),
            created_at: env.ledger().timestamp(),
            total_usdc: 0,
            circulating_shares: 0,
            hwm_nav: PRECISION,
            realized_pnl: 0,
            leader_shares: 0,
            profit_share_bps: DEFAULT_PROFIT_SHARE_BPS,
            paused: false,
        };
        storage::save_vault(&env, &info);
        storage::append_vault_list(&env, id);
        storage::extend_instance_ttl(&env);
        env.events()
            .publish((Symbol::new(&env, "vault_created"), id), (leader, name));
        Ok(id)
    }

    // ───────────────────────────────────────────────────────────────────
    // Read-only views
    // ───────────────────────────────────────────────────────────────────

    pub fn get_vault(env: Env, vault_id: u32) -> Result<VaultInfo, FactoryError> {
        storage::load_vault(&env, vault_id)
    }

    pub fn get_vault_ids(env: Env) -> Vec<u32> {
        storage::get_vault_list(&env)
    }

    pub fn get_admin(env: Env) -> Result<Address, FactoryError> {
        storage::require_initialized(&env)?;
        Ok(storage::get_admin(&env))
    }

    pub fn get_market(env: Env) -> Result<Address, FactoryError> {
        storage::require_initialized(&env)?;
        Ok(storage::get_market(&env))
    }

    pub fn get_usdc(env: Env) -> Result<Address, FactoryError> {
        storage::require_initialized(&env)?;
        Ok(storage::get_usdc(&env))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{Env, String};

    fn setup() -> (Env, Address, Address, Address, soroban_sdk::Address) {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
        let id = env.register_contract(None, VaultFactoryContract);
        let admin = Address::generate(&env);
        let market = Address::generate(&env);
        let usdc = Address::generate(&env);
        let client = VaultFactoryContractClient::new(&env, &id);
        client.initialize(&admin, &market, &usdc);
        (env, admin, market, usdc, id)
    }

    #[test]
    fn version_returns_marker() {
        let env = Env::default();
        let id = env.register_contract(None, VaultFactoryContract);
        let client = VaultFactoryContractClient::new(&env, &id);
        assert_eq!(client.version(), Symbol::new(&env, "vault_factory_v0"));
    }

    #[test]
    fn initialize_pins_admin_market_usdc() {
        let (env, admin, market, usdc, id) = setup();
        let client = VaultFactoryContractClient::new(&env, &id);
        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.get_market(), market);
        assert_eq!(client.get_usdc(), usdc);
    }

    #[test]
    fn initialize_is_one_shot() {
        let (env, admin, market, usdc, id) = setup();
        let client = VaultFactoryContractClient::new(&env, &id);
        let res = client.try_initialize(&admin, &market, &usdc);
        assert_eq!(res, Err(Ok(FactoryError::AlreadyInitialized)));
    }

    #[test]
    fn create_vault_assigns_sequential_ids() {
        let (env, _admin, _market, _usdc, id) = setup();
        let client = VaultFactoryContractClient::new(&env, &id);
        let leader = Address::generate(&env);
        let v0 = client.create_vault(&leader, &String::from_str(&env, "alpha"));
        let v1 = client.create_vault(&leader, &String::from_str(&env, "beta"));
        assert_eq!(v0, 0);
        assert_eq!(v1, 1);
        let ids = client.get_vault_ids();
        assert_eq!(ids.len(), 2);
    }

    #[test]
    fn create_vault_records_starting_state() {
        let (env, _admin, _market, _usdc, id) = setup();
        let client = VaultFactoryContractClient::new(&env, &id);
        let leader = Address::generate(&env);
        let vault_id = client.create_vault(&leader, &String::from_str(&env, "alpha"));
        let info = client.get_vault(&vault_id);
        assert_eq!(info.id, 0);
        assert_eq!(info.leader, leader);
        assert_eq!(info.total_usdc, 0);
        assert_eq!(info.circulating_shares, 0);
        assert_eq!(info.hwm_nav, PRECISION);
        assert_eq!(info.profit_share_bps, DEFAULT_PROFIT_SHARE_BPS);
        assert_eq!(info.paused, false);
    }

    #[test]
    fn create_vault_rejects_empty_or_long_name() {
        let (env, _admin, _market, _usdc, id) = setup();
        let client = VaultFactoryContractClient::new(&env, &id);
        let leader = Address::generate(&env);
        let empty = client.try_create_vault(&leader, &String::from_str(&env, ""));
        assert_eq!(empty, Err(Ok(FactoryError::InvalidName)));
        let too_long = String::from_str(&env, &"x".repeat(65));
        let long = client.try_create_vault(&leader, &too_long);
        assert_eq!(long, Err(Ok(FactoryError::InvalidName)));
    }

    #[test]
    fn get_vault_unknown_id_returns_error() {
        let (env, _admin, _market, _usdc, id) = setup();
        let client = VaultFactoryContractClient::new(&env, &id);
        let res = client.try_get_vault(&999);
        match res {
            Err(Ok(FactoryError::VaultNotFound)) => {}
            other => panic!("expected VaultNotFound, got {:?}", other),
        }
    }
}
