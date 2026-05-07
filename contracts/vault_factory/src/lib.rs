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

use soroban_sdk::{contract, contractimpl, token, Address, Env, String, Symbol, Vec};

mod math;
mod storage;
mod types;

pub use types::{
    FactoryError, VaultInfo, DEFAULT_PROFIT_SHARE_BPS, LEADER_MIN_HOLDING_BPS,
    MAX_PROFIT_SHARE_BPS, PRECISION,
};

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

    /// Deposit USDC into a vault and receive proportional shares.
    /// Returns the number of shares minted to the depositor.
    pub fn deposit(
        env: Env,
        depositor: Address,
        vault_id: u32,
        amount: i128,
    ) -> Result<i128, FactoryError> {
        storage::require_initialized(&env)?;
        depositor.require_auth();
        if amount <= 0 {
            return Err(FactoryError::AmountMustBePositive);
        }
        let mut info = storage::load_vault(&env, vault_id)?;
        if info.paused {
            return Err(FactoryError::Paused);
        }
        let shares =
            math::shares_for_deposit(amount, info.total_usdc, info.circulating_shares)?;
        if shares <= 0 {
            return Err(FactoryError::AmountMustBePositive);
        }

        // Move USDC into the factory contract — the factory holds vault
        // funds. Soroban authorisation: depositor signs the entry call,
        // which authorises the sub-invocation to usdc.transfer(from=depositor).
        let usdc_addr = storage::get_usdc(&env);
        token::Client::new(&env, &usdc_addr).transfer(
            &depositor,
            &env.current_contract_address(),
            &amount,
        );

        info.total_usdc = info.total_usdc.checked_add(amount).ok_or(FactoryError::Overflow)?;
        info.circulating_shares = info
            .circulating_shares
            .checked_add(shares)
            .ok_or(FactoryError::Overflow)?;
        if depositor == info.leader {
            info.leader_shares = info
                .leader_shares
                .checked_add(shares)
                .ok_or(FactoryError::Overflow)?;
        }
        // 5% leader-skin invariant. Outside depositors can only flow in
        // up to (1 / LEADER_MIN_HOLDING_BPS) × leader_shares total
        // circulating shares; further dilution requires the leader to
        // top up first.
        if !math::leader_min_holding_ok(
            info.leader_shares,
            info.circulating_shares,
            LEADER_MIN_HOLDING_BPS,
        ) {
            return Err(FactoryError::LeaderMinimumViolated);
        }
        storage::save_vault(&env, &info);

        let prior = storage::shares_of(&env, vault_id, &depositor);
        let next = prior.checked_add(shares).ok_or(FactoryError::Overflow)?;
        storage::set_shares(&env, vault_id, &depositor, next);
        storage::extend_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "deposit"), vault_id),
            (depositor, amount, shares),
        );
        Ok(shares)
    }

    /// Burn shares and receive USDC back. Returns the USDC paid out.
    pub fn withdraw(
        env: Env,
        depositor: Address,
        vault_id: u32,
        shares: i128,
    ) -> Result<i128, FactoryError> {
        storage::require_initialized(&env)?;
        depositor.require_auth();
        if shares <= 0 {
            return Err(FactoryError::AmountMustBePositive);
        }
        let mut info = storage::load_vault(&env, vault_id)?;
        if info.paused {
            return Err(FactoryError::Paused);
        }
        let owned = storage::shares_of(&env, vault_id, &depositor);
        if shares > owned {
            return Err(FactoryError::InsufficientShares);
        }
        let usdc_out =
            math::usdc_for_withdraw(shares, info.total_usdc, info.circulating_shares)?;
        if usdc_out > info.total_usdc {
            return Err(FactoryError::InsufficientBalance);
        }

        let usdc_addr = storage::get_usdc(&env);
        token::Client::new(&env, &usdc_addr).transfer(
            &env.current_contract_address(),
            &depositor,
            &usdc_out,
        );

        info.total_usdc -= usdc_out;
        info.circulating_shares -= shares;
        if depositor == info.leader {
            info.leader_shares -= shares;
        }
        // Same 5% invariant on the way out — leader can't drain their
        // skin below 5% of remaining outside capital. Skipped when the
        // vault is fully empty after withdrawal (circulating == 0).
        if !math::leader_min_holding_ok(
            info.leader_shares,
            info.circulating_shares,
            LEADER_MIN_HOLDING_BPS,
        ) {
            return Err(FactoryError::LeaderMinimumViolated);
        }
        storage::save_vault(&env, &info);

        let next = owned - shares;
        storage::set_shares(&env, vault_id, &depositor, next);
        storage::extend_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "withdraw"), vault_id),
            (depositor, shares, usdc_out),
        );
        Ok(usdc_out)
    }

    /// Read a depositor's share balance for a given vault.
    pub fn shares_of(env: Env, vault_id: u32, depositor: Address) -> i128 {
        storage::shares_of(&env, vault_id, &depositor)
    }

    /// Leader pulls accumulated profit share above HWM. Returns the
    /// USDC paid out (zero if NAV ≤ HWM).
    ///
    /// Formula: ((NAV - HWM) × circulating_shares ÷ PRECISION) × bps ÷ 10_000.
    /// On success, total_usdc decreases by the payout and the new HWM
    /// is set to the post-payout NAV — the leader can't double-claim
    /// the same gain.
    pub fn claim_leader_fees(env: Env, vault_id: u32) -> Result<i128, FactoryError> {
        storage::require_initialized(&env)?;
        let mut info = storage::load_vault(&env, vault_id)?;
        info.leader.require_auth();

        let owed = math::leader_profit_owed(
            info.total_usdc,
            info.circulating_shares,
            info.hwm_nav,
            info.profit_share_bps,
        )?;
        if owed <= 0 {
            return Err(FactoryError::NoFeesToClaim);
        }
        if owed > info.total_usdc {
            return Err(FactoryError::InsufficientBalance);
        }

        let usdc_addr = storage::get_usdc(&env);
        token::Client::new(&env, &usdc_addr).transfer(
            &env.current_contract_address(),
            &info.leader,
            &owed,
        );

        info.total_usdc -= owed;
        info.realized_pnl = info
            .realized_pnl
            .checked_add(owed)
            .ok_or(FactoryError::Overflow)?;
        let new_nav = math::nav_per_share(info.total_usdc, info.circulating_shares)?;
        info.hwm_nav = new_nav;
        storage::save_vault(&env, &info);
        storage::extend_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "fees_claimed"), vault_id),
            (info.leader.clone(), owed, new_nav),
        );
        Ok(owed)
    }

    /// Leader-only pause / unpause for their own vault.
    /// While paused, deposit() and withdraw() return FactoryError::Paused.
    pub fn set_paused(env: Env, vault_id: u32, paused: bool) -> Result<(), FactoryError> {
        storage::require_initialized(&env)?;
        let mut info = storage::load_vault(&env, vault_id)?;
        info.leader.require_auth();
        info.paused = paused;
        storage::save_vault(&env, &info);
        env.events().publish(
            (Symbol::new(&env, if paused { "paused" } else { "unpaused" }), vault_id),
            (),
        );
        Ok(())
    }

    /// Admin-only emergency pause. Doesn't require leader signature.
    pub fn admin_pause(env: Env, vault_id: u32, paused: bool) -> Result<(), FactoryError> {
        storage::require_admin(&env)?;
        let mut info = storage::load_vault(&env, vault_id)?;
        info.paused = paused;
        storage::save_vault(&env, &info);
        env.events().publish(
            (Symbol::new(&env, if paused { "admin_paused" } else { "admin_unpaused" }), vault_id),
            (),
        );
        Ok(())
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

    /// Variant of `setup` that wires a real Stellar Asset Contract for USDC,
    /// so tests can exercise deposit/withdraw end-to-end. The returned
    /// `wallet` doubles as leader+depositor — single-actor tests pass
    /// the 5% invariant trivially since leader_shares == circulating.
    fn setup_with_usdc(
        initial_balance: i128,
    ) -> (
        Env,
        Address,         // admin
        Address,         // market
        Address,         // usdc contract id
        soroban_sdk::Address, // factory contract id
        Address,         // wallet (leader + depositor in single-actor tests)
    ) {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
        let factory_id = env.register_contract(None, VaultFactoryContract);
        let admin = Address::generate(&env);
        let market = Address::generate(&env);
        let usdc_sac = env.register_stellar_asset_contract_v2(admin.clone());
        let usdc_id = usdc_sac.address();
        let wallet = Address::generate(&env);
        let usdc_admin = soroban_sdk::token::StellarAssetClient::new(&env, &usdc_id);
        usdc_admin.mint(&wallet, &initial_balance);
        let client = VaultFactoryContractClient::new(&env, &factory_id);
        client.initialize(&admin, &market, &usdc_id);
        (env, admin, market, usdc_id, factory_id, wallet)
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
    fn deposit_mints_shares_and_moves_usdc() {
        let (env, _admin, _market, usdc, factory, leader) = setup_with_usdc(1_000_0000000);
        let client = VaultFactoryContractClient::new(&env, &factory);
        let vault_id = client.create_vault(&leader, &String::from_str(&env, "alpha"));

        let usdc_token = soroban_sdk::token::Client::new(&env, &usdc);
        let shares = client.deposit(&leader, &vault_id, &500_0000000);
        assert_eq!(shares, 500_0000000); // first deposit = 1:1

        assert_eq!(usdc_token.balance(&leader), 500_0000000);
        assert_eq!(usdc_token.balance(&factory), 500_0000000);

        let info = client.get_vault(&vault_id);
        assert_eq!(info.total_usdc, 500_0000000);
        assert_eq!(info.circulating_shares, 500_0000000);
        assert_eq!(info.leader_shares, 500_0000000);
        assert_eq!(client.shares_of(&vault_id, &leader), 500_0000000);
    }

    #[test]
    fn second_deposit_at_par_nav_mints_one_to_one() {
        let (env, _admin, _market, _usdc, factory, leader) = setup_with_usdc(2_000_0000000);
        let client = VaultFactoryContractClient::new(&env, &factory);
        let vault_id = client.create_vault(&leader, &String::from_str(&env, "alpha"));
        client.deposit(&leader, &vault_id, &1_000_0000000);
        // NAV is still 1.0; second deposit mints 1:1.
        let shares2 = client.deposit(&leader, &vault_id, &500_0000000);
        assert_eq!(shares2, 500_0000000);
    }

    #[test]
    fn deposit_rejects_zero_amount() {
        let (env, _admin, _market, _usdc, factory, leader) = setup_with_usdc(1_000_0000000);
        let client = VaultFactoryContractClient::new(&env, &factory);
        let vault_id = client.create_vault(&leader, &String::from_str(&env, "alpha"));
        let res = client.try_deposit(&leader, &vault_id, &0);
        assert_eq!(res, Err(Ok(FactoryError::AmountMustBePositive)));
    }

    #[test]
    fn deposit_rejects_unknown_vault() {
        let (env, _admin, _market, _usdc, factory, wallet) = setup_with_usdc(1_000_0000000);
        let client = VaultFactoryContractClient::new(&env, &factory);
        let res = client.try_deposit(&wallet, &999, &100_0000000);
        assert_eq!(res, Err(Ok(FactoryError::VaultNotFound)));
    }

    #[test]
    fn withdraw_returns_proportional_usdc() {
        let (env, _admin, _market, usdc, factory, leader) = setup_with_usdc(1_000_0000000);
        let client = VaultFactoryContractClient::new(&env, &factory);
        let vault_id = client.create_vault(&leader, &String::from_str(&env, "alpha"));
        client.deposit(&leader, &vault_id, &1_000_0000000);
        let usdc_token = soroban_sdk::token::Client::new(&env, &usdc);
        assert_eq!(usdc_token.balance(&leader), 0);

        let usdc_back = client.withdraw(&leader, &vault_id, &400_0000000);
        assert_eq!(usdc_back, 400_0000000);
        assert_eq!(usdc_token.balance(&leader), 400_0000000);
        assert_eq!(usdc_token.balance(&factory), 600_0000000);

        let info = client.get_vault(&vault_id);
        assert_eq!(info.total_usdc, 600_0000000);
        assert_eq!(info.circulating_shares, 600_0000000);
        assert_eq!(client.shares_of(&vault_id, &leader), 600_0000000);
    }

    #[test]
    fn withdraw_rejects_more_than_owned() {
        let (env, _admin, _market, _usdc, factory, leader) = setup_with_usdc(1_000_0000000);
        let client = VaultFactoryContractClient::new(&env, &factory);
        let vault_id = client.create_vault(&leader, &String::from_str(&env, "alpha"));
        client.deposit(&leader, &vault_id, &100_0000000);
        let res = client.try_withdraw(&leader, &vault_id, &500_0000000);
        assert_eq!(res, Err(Ok(FactoryError::InsufficientShares)));
    }

    #[test]
    fn claim_with_no_gain_returns_no_fees() {
        let (env, _admin, _market, usdc, factory, leader) = setup_with_usdc(1_000_0000000);
        let client = VaultFactoryContractClient::new(&env, &factory);
        // Setup: leader doubles as depositor (skin in the game).
        let vault_id = client.create_vault(&leader, &String::from_str(&env, "alpha"));
        client.deposit(&leader, &vault_id, &500_0000000);
        let _ = usdc;
        // NAV is exactly HWM (1.0); leader has no profit to claim.
        let res = client.try_claim_leader_fees(&vault_id);
        assert_eq!(res, Err(Ok(FactoryError::NoFeesToClaim)));
    }

    #[test]
    fn outsider_first_deposit_violates_leader_minimum() {
        // No leader stake yet → any outside deposit fails the 5% invariant.
        let (env, _admin, _market, _usdc, factory, depositor) = setup_with_usdc(1_000_0000000);
        let client = VaultFactoryContractClient::new(&env, &factory);
        let leader = Address::generate(&env);
        let vault_id = client.create_vault(&leader, &String::from_str(&env, "alpha"));
        let res = client.try_deposit(&depositor, &vault_id, &100_0000000);
        assert_eq!(res, Err(Ok(FactoryError::LeaderMinimumViolated)));
    }

    #[test]
    fn leader_seeds_then_outsider_can_deposit_up_to_19x() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
        let factory_id = env.register_contract(None, VaultFactoryContract);
        let admin = Address::generate(&env);
        let market = Address::generate(&env);
        let usdc_sac = env.register_stellar_asset_contract_v2(admin.clone());
        let usdc_id = usdc_sac.address();
        let leader = Address::generate(&env);
        let outsider = Address::generate(&env);
        let usdc_admin = soroban_sdk::token::StellarAssetClient::new(&env, &usdc_id);
        usdc_admin.mint(&leader, &100_0000000);
        usdc_admin.mint(&outsider, &10_000_0000000);
        let client = VaultFactoryContractClient::new(&env, &factory_id);
        client.initialize(&admin, &market, &usdc_id);
        let vault_id = client.create_vault(&leader, &String::from_str(&env, "alpha"));

        // Leader seeds 100 USDC.
        client.deposit(&leader, &vault_id, &100_0000000);
        // Outsider can deposit up to 19× = 1900 USDC.
        let ok = client.deposit(&outsider, &vault_id, &1_900_0000000);
        assert!(ok > 0);
        // One more USDC violates 5%.
        let too_much = client.try_deposit(&outsider, &vault_id, &1_0000000);
        assert_eq!(too_much, Err(Ok(FactoryError::LeaderMinimumViolated)));
    }

    #[test]
    fn leader_withdraw_blocked_if_invariant_breaks() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
        let factory_id = env.register_contract(None, VaultFactoryContract);
        let admin = Address::generate(&env);
        let market = Address::generate(&env);
        let usdc_sac = env.register_stellar_asset_contract_v2(admin.clone());
        let usdc_id = usdc_sac.address();
        let leader = Address::generate(&env);
        let outsider = Address::generate(&env);
        let usdc_admin = soroban_sdk::token::StellarAssetClient::new(&env, &usdc_id);
        usdc_admin.mint(&leader, &100_0000000);
        usdc_admin.mint(&outsider, &1_000_0000000);
        let client = VaultFactoryContractClient::new(&env, &factory_id);
        client.initialize(&admin, &market, &usdc_id);
        let vault_id = client.create_vault(&leader, &String::from_str(&env, "alpha"));
        client.deposit(&leader, &vault_id, &100_0000000);
        client.deposit(&outsider, &vault_id, &1_000_0000000);
        // Leader has 100/1100 = 9.09%. Withdrawing 60 leaves 40/1040 = 3.85% — fails.
        let res = client.try_withdraw(&leader, &vault_id, &60_0000000);
        assert_eq!(res, Err(Ok(FactoryError::LeaderMinimumViolated)));
    }

    #[test]
    fn paused_vault_blocks_deposit_and_withdraw() {
        let (env, _admin, _market, _usdc, factory, leader) = setup_with_usdc(1_000_0000000);
        let client = VaultFactoryContractClient::new(&env, &factory);
        let vault_id = client.create_vault(&leader, &String::from_str(&env, "alpha"));
        client.deposit(&leader, &vault_id, &200_0000000);
        client.set_paused(&vault_id, &true);

        let dep_res = client.try_deposit(&leader, &vault_id, &100_0000000);
        assert_eq!(dep_res, Err(Ok(FactoryError::Paused)));
        let wd_res = client.try_withdraw(&leader, &vault_id, &50_0000000);
        assert_eq!(wd_res, Err(Ok(FactoryError::Paused)));

        client.set_paused(&vault_id, &false);
        let again = client.deposit(&leader, &vault_id, &100_0000000);
        assert!(again > 0);
    }

    #[test]
    fn admin_pause_works_independently_of_leader() {
        let (env, _admin, _market, _usdc, factory, leader) = setup_with_usdc(1_000_0000000);
        let client = VaultFactoryContractClient::new(&env, &factory);
        let vault_id = client.create_vault(&leader, &String::from_str(&env, "alpha"));
        client.deposit(&leader, &vault_id, &200_0000000);
        client.admin_pause(&vault_id, &true);
        let info = client.get_vault(&vault_id);
        assert_eq!(info.paused, true);
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
