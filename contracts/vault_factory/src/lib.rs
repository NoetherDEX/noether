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

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractimpl, contracttype, token, vec as svec, Address, Env, IntoVal, String,
    Symbol, Vec,
};

use noether_common::types::{Order, Position};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Copy)]
pub enum Direction {
    Long = 0,
    Short = 1,
}

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

    // ───────────────────────────────────────────────────────────────────
    // Public view fns — let the web frontend read marketplace state
    // straight from the chain so the API gateway becomes optional for
    // the listing flow. The indexer + REST API still serve activity
    // history, but the vault grid never depends on them.
    // ───────────────────────────────────────────────────────────────────

    /// Total number of vaults ever created. Vault ids are dense from 0
    /// to `vault_count() - 1`.
    pub fn vault_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get::<types::StorageKey, u32>(&types::StorageKey::NextVaultId)
            .unwrap_or(0)
    }

    /// Fetch the full VaultInfo struct for a given id. Errors with
    /// `VaultNotFound` if the id has never been minted.
    pub fn view_vault(env: Env, vault_id: u32) -> Result<VaultInfo, FactoryError> {
        storage::load_vault(&env, vault_id)
    }

    // ───────────────────────────────────────────────────────────────────
    // Leader trading proxies — call market contract on behalf of the
    // vault. The vault's USDC backs the trade; the leader signs.
    // ───────────────────────────────────────────────────────────────────

    /// Leader opens an isolated position using vault funds.
    /// Returns the market's position id. After the call total_usdc is
    /// resynced from the on-chain USDC balance, so the vault's
    /// accounting always matches truth.
    pub fn leader_open_position(
        env: Env,
        leader: Address,
        vault_id: u32,
        asset: Symbol,
        collateral: i128,
        leverage: u32,
        direction: u32,
    ) -> Result<u64, FactoryError> {
        let mut info = require_leader_call(&env, &leader, vault_id)?;
        if collateral <= 0 {
            return Err(FactoryError::AmountMustBePositive);
        }
        if collateral > info.total_usdc {
            return Err(FactoryError::InsufficientBalance);
        }
        let market = storage::get_market(&env);
        let usdc = storage::get_usdc(&env);
        let factory = env.current_contract_address();
        // Map our u32 wire format onto the Direction enum the market
        // contract actually expects. Same discriminants (0=Long, 1=Short)
        // so this is a pure wrapper.
        let direction_enum = match direction {
            0 => Direction::Long,
            1 => Direction::Short,
            _ => return Err(FactoryError::InvalidParameter),
        };
        let open_args: Vec<soroban_sdk::Val> = (
            factory.clone(),
            asset.clone(),
            collateral,
            leverage,
            direction_enum,
        )
            .into_val(&env);
        // The direct factory→market call is auto-authorised by Soroban.
        // We only need to declare the *deeper* call that requires the
        // factory's signature: market→usdc.transfer(from=factory).
        env.authorize_as_current_contract(svec![
            &env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: usdc.clone(),
                    fn_name: Symbol::new(&env, "transfer"),
                    args: (factory.clone(), market.clone(), collateral).into_val(&env),
                },
                sub_invocations: svec![&env],
            }),
        ]);
        let position: Position =
            env.invoke_contract(&market, &Symbol::new(&env, "open_position"), open_args);
        let position_id = position.id;
        sync_total_usdc(&env, &mut info)?;
        check_invariant(&info)?;
        storage::save_vault(&env, &info);
        env.events().publish(
            (Symbol::new(&env, "leader_open"), vault_id),
            (leader, position_id, collateral),
        );
        Ok(position_id)
    }

    /// Leader closes an existing isolated position. The market
    /// settles PnL into the vault's USDC balance; we resync.
    pub fn leader_close_position(
        env: Env,
        leader: Address,
        vault_id: u32,
        position_id: u64,
    ) -> Result<(), FactoryError> {
        let mut info = require_leader_call(&env, &leader, vault_id)?;
        let market = storage::get_market(&env);
        let factory = env.current_contract_address();
        let args = svec![&env, factory.clone().into_val(&env), position_id.into_val(&env)];
        // close_position is a direct call (auto-authorised) and only
        // performs market-internal transfers (from = market). Nothing
        // deeper needs the factory's auth.
        let _: i128 = env.invoke_contract(&market, &Symbol::new(&env, "close_position"), args);
        sync_total_usdc(&env, &mut info)?;
        // Bumping HWM is not appropriate here; HWM moves only on claim.
        // Realised PnL relative to the prior total_usdc is captured
        // implicitly via the on-chain balance read.
        storage::save_vault(&env, &info);
        env.events().publish(
            (Symbol::new(&env, "leader_close"), vault_id),
            (leader, position_id),
        );
        Ok(())
    }

    /// Leader places a limit order using vault funds.
    pub fn leader_place_limit_order(
        env: Env,
        leader: Address,
        vault_id: u32,
        asset: Symbol,
        collateral: i128,
        leverage: u32,
        direction: u32,
        trigger_price: i128,
        trigger_above: bool,
        slippage_tolerance_bps: u32,
    ) -> Result<u64, FactoryError> {
        let mut info = require_leader_call(&env, &leader, vault_id)?;
        if collateral <= 0 {
            return Err(FactoryError::AmountMustBePositive);
        }
        if collateral > info.total_usdc {
            return Err(FactoryError::InsufficientBalance);
        }
        let market = storage::get_market(&env);
        let usdc = storage::get_usdc(&env);
        let factory = env.current_contract_address();
        // place_limit_order takes Direction, time_in_force trailing arg.
        let direction_enum = match direction {
            0 => Direction::Long,
            1 => Direction::Short,
            _ => return Err(FactoryError::InvalidParameter),
        };
        let args: Vec<soroban_sdk::Val> = (
            factory.clone(),
            asset.clone(),
            direction_enum,
            collateral,
            leverage,
            trigger_price,
            trigger_above,
            slippage_tolerance_bps,
            0u32, // time_in_force = GTC (default for vault-leader orders)
        )
            .into_val(&env);
        // Only declare the deeper SAC transfer with from=factory.
        env.authorize_as_current_contract(svec![
            &env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: usdc.clone(),
                    fn_name: Symbol::new(&env, "transfer"),
                    args: (factory.clone(), market.clone(), collateral).into_val(&env),
                },
                sub_invocations: svec![&env],
            }),
        ]);
        let order: Order = env.invoke_contract(&market, &Symbol::new(&env, "place_limit_order"), args);
        let order_id = order.id;
        // place_limit_order may or may not pull collateral immediately
        // depending on market rules; resync defensively.
        sync_total_usdc(&env, &mut info)?;
        storage::save_vault(&env, &info);
        env.events().publish(
            (Symbol::new(&env, "leader_limit"), vault_id),
            (leader, order_id),
        );
        Ok(order_id)
    }

    /// Leader cancels a previously placed order.
    pub fn leader_cancel_order(
        env: Env,
        leader: Address,
        vault_id: u32,
        order_id: u64,
    ) -> Result<(), FactoryError> {
        let mut info = require_leader_call(&env, &leader, vault_id)?;
        let market = storage::get_market(&env);
        let factory = env.current_contract_address();
        let args = svec![&env, factory.clone().into_val(&env), order_id.into_val(&env)];
        // Direct call — Soroban auto-authorises. cancel_order's internal
        // refund transfer has from=market so it needs no factory auth.
        env.invoke_contract::<()>(&market, &Symbol::new(&env, "cancel_order"), args);
        sync_total_usdc(&env, &mut info)?;
        storage::save_vault(&env, &info);
        env.events().publish(
            (Symbol::new(&env, "leader_cancel"), vault_id),
            (leader, order_id),
        );
        Ok(())
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

// Free-standing helpers used by the leader_* trading proxies. Kept
// outside the #[contractimpl] block so they remain private and don't
// pollute the contract's public surface.
fn require_leader_call(
    env: &Env,
    leader: &Address,
    vault_id: u32,
) -> Result<VaultInfo, FactoryError> {
    storage::require_initialized(env)?;
    leader.require_auth();
    let info = storage::load_vault(env, vault_id)?;
    if info.leader != *leader {
        return Err(FactoryError::NotLeader);
    }
    if info.paused {
        return Err(FactoryError::Paused);
    }
    Ok(info)
}

fn sync_total_usdc(env: &Env, info: &mut VaultInfo) -> Result<(), FactoryError> {
    let usdc_addr = storage::get_usdc(env);
    let token_client = token::Client::new(env, &usdc_addr);
    info.total_usdc = token_client.balance(&env.current_contract_address());
    Ok(())
}

fn check_invariant(info: &VaultInfo) -> Result<(), FactoryError> {
    if !math::leader_min_holding_ok(
        info.leader_shares,
        info.circulating_shares,
        LEADER_MIN_HOLDING_BPS,
    ) {
        return Err(FactoryError::LeaderMinimumViolated);
    }
    Ok(())
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
        assert!(!info.paused);
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

    /// Stub market contract used by leader_* tests. Records the calls it
    /// receives so the test can assert the proxy passed the right args.
    /// open_position pulls collateral via USDC SAC — the same way the
    /// real market does — to exercise the auth chain end-to-end.
    mod fake_market {
        use soroban_sdk::{contract, contractimpl, token, Address, Env, Symbol};
        use noether_common::types::{Direction, Position};

        #[contract]
        pub struct FakeMarket;

        #[contractimpl]
        impl FakeMarket {
            pub fn init(env: Env, usdc: Address) {
                env.storage().instance().set(&Symbol::new(&env, "usdc"), &usdc);
                env.storage()
                    .instance()
                    .set(&Symbol::new(&env, "next_id"), &0u64);
            }
            // Returns a full Position (matching the real market) so the
            // factory's `let position: Position = invoke_contract(...)` decodes.
            pub fn open_position(
                env: Env,
                trader: Address,
                asset: Symbol,
                collateral: i128,
                leverage: u32,
                direction: u32,
            ) -> Position {
                trader.require_auth();
                let usdc: Address = env
                    .storage()
                    .instance()
                    .get(&Symbol::new(&env, "usdc"))
                    .unwrap();
                token::Client::new(&env, &usdc).transfer(
                    &trader,
                    &env.current_contract_address(),
                    &collateral,
                );
                let mut id: u64 = env
                    .storage()
                    .instance()
                    .get(&Symbol::new(&env, "next_id"))
                    .unwrap_or(0);
                id += 1;
                env.storage()
                    .instance()
                    .set(&Symbol::new(&env, "next_id"), &id);
                Position {
                    id,
                    trader,
                    asset,
                    collateral,
                    size: collateral.saturating_mul(leverage as i128),
                    entry_price: 0,
                    direction: if direction == 1 { Direction::Short } else { Direction::Long },
                    leverage,
                    liquidation_price: 0,
                    timestamp: 0,
                    entry_cumulative_funding: 0,
                    margin_mode: 0,
                }
            }
            // Returns settled USDC as i128 (matching the real market), so the
            // factory's `let _: i128 = invoke_contract(...)` decodes.
            pub fn close_position(env: Env, trader: Address, _position_id: u64) -> i128 {
                // Refund the held balance so the vault receives "settled" USDC.
                trader.require_auth();
                let usdc: Address = env
                    .storage()
                    .instance()
                    .get(&Symbol::new(&env, "usdc"))
                    .unwrap();
                let market_addr = env.current_contract_address();
                let bal = token::Client::new(&env, &usdc).balance(&market_addr);
                if bal > 0 {
                    token::Client::new(&env, &usdc).transfer(&market_addr, &trader, &bal);
                }
                bal
            }
        }
    }

    #[test]
    fn leader_open_position_proxies_to_market_and_decrements_balance() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
        let factory_id = env.register_contract(None, VaultFactoryContract);
        let admin = Address::generate(&env);
        let usdc_sac = env.register_stellar_asset_contract_v2(admin.clone());
        let usdc_id = usdc_sac.address();
        let market_id = env.register_contract(None, fake_market::FakeMarket);
        let leader = Address::generate(&env);
        let usdc_admin = soroban_sdk::token::StellarAssetClient::new(&env, &usdc_id);
        usdc_admin.mint(&leader, &10_000_0000000);

        let factory = VaultFactoryContractClient::new(&env, &factory_id);
        factory.initialize(&admin, &market_id, &usdc_id);
        let market = fake_market::FakeMarketClient::new(&env, &market_id);
        market.init(&usdc_id);

        let vault_id = factory.create_vault(&leader, &String::from_str(&env, "alpha"));
        factory.deposit(&leader, &vault_id, &1_000_0000000);

        let position_id = factory.leader_open_position(
            &leader,
            &vault_id,
            &Symbol::new(&env, "BTC"),
            &200_0000000,
            &5,
            &0u32,
        );
        assert_eq!(position_id, 1);

        // Vault state synced: total_usdc went from 1000 to 800.
        let info = factory.get_vault(&vault_id);
        assert_eq!(info.total_usdc, 800_0000000);

        // Fake market now holds the collateral.
        let usdc_token = soroban_sdk::token::Client::new(&env, &usdc_id);
        assert_eq!(usdc_token.balance(&market_id), 200_0000000);
    }

    #[test]
    fn leader_open_position_rejects_non_leader() {
        let env = Env::default();
        env.mock_all_auths();
        let factory_id = env.register_contract(None, VaultFactoryContract);
        let admin = Address::generate(&env);
        let usdc_sac = env.register_stellar_asset_contract_v2(admin.clone());
        let usdc_id = usdc_sac.address();
        let market_id = env.register_contract(None, fake_market::FakeMarket);
        let factory = VaultFactoryContractClient::new(&env, &factory_id);
        factory.initialize(&admin, &market_id, &usdc_id);
        let market = fake_market::FakeMarketClient::new(&env, &market_id);
        market.init(&usdc_id);
        let leader = Address::generate(&env);
        let usdc_admin = soroban_sdk::token::StellarAssetClient::new(&env, &usdc_id);
        usdc_admin.mint(&leader, &1_000_0000000);
        let vault_id = factory.create_vault(&leader, &String::from_str(&env, "alpha"));
        factory.deposit(&leader, &vault_id, &500_0000000);

        let stranger = Address::generate(&env);
        let res = factory.try_leader_open_position(
            &stranger,
            &vault_id,
            &Symbol::new(&env, "BTC"),
            &100_0000000,
            &5,
            &0u32,
        );
        assert_eq!(res, Err(Ok(FactoryError::NotLeader)));
    }

    #[test]
    fn leader_open_position_rejects_collateral_above_balance() {
        let env = Env::default();
        env.mock_all_auths();
        let factory_id = env.register_contract(None, VaultFactoryContract);
        let admin = Address::generate(&env);
        let usdc_sac = env.register_stellar_asset_contract_v2(admin.clone());
        let usdc_id = usdc_sac.address();
        let market_id = env.register_contract(None, fake_market::FakeMarket);
        let factory = VaultFactoryContractClient::new(&env, &factory_id);
        factory.initialize(&admin, &market_id, &usdc_id);
        let market = fake_market::FakeMarketClient::new(&env, &market_id);
        market.init(&usdc_id);
        let leader = Address::generate(&env);
        let usdc_admin = soroban_sdk::token::StellarAssetClient::new(&env, &usdc_id);
        usdc_admin.mint(&leader, &1_000_0000000);
        let vault_id = factory.create_vault(&leader, &String::from_str(&env, "alpha"));
        factory.deposit(&leader, &vault_id, &100_0000000);

        let res = factory.try_leader_open_position(
            &leader,
            &vault_id,
            &Symbol::new(&env, "BTC"),
            &500_0000000,
            &5,
            &0u32,
        );
        assert_eq!(res, Err(Ok(FactoryError::InsufficientBalance)));
    }

    #[test]
    fn leader_close_position_resyncs_balance_after_settlement() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        let factory_id = env.register_contract(None, VaultFactoryContract);
        let admin = Address::generate(&env);
        let usdc_sac = env.register_stellar_asset_contract_v2(admin.clone());
        let usdc_id = usdc_sac.address();
        let market_id = env.register_contract(None, fake_market::FakeMarket);
        let factory = VaultFactoryContractClient::new(&env, &factory_id);
        factory.initialize(&admin, &market_id, &usdc_id);
        let market = fake_market::FakeMarketClient::new(&env, &market_id);
        market.init(&usdc_id);
        let leader = Address::generate(&env);
        let usdc_admin = soroban_sdk::token::StellarAssetClient::new(&env, &usdc_id);
        usdc_admin.mint(&leader, &10_000_0000000);
        let vault_id = factory.create_vault(&leader, &String::from_str(&env, "alpha"));
        factory.deposit(&leader, &vault_id, &1_000_0000000);
        let position_id = factory.leader_open_position(
            &leader,
            &vault_id,
            &Symbol::new(&env, "BTC"),
            &200_0000000,
            &5,
            &0u32,
        );
        // Mint a "PnL" of 50 USDC into the market so close_position
        // refunds 250 USDC back to the factory.
        usdc_admin.mint(&market_id, &50_0000000);

        factory.leader_close_position(&leader, &vault_id, &position_id);
        let info = factory.get_vault(&vault_id);
        // Initial 1000 - 200 (open) + 250 (close incl. PnL) = 1050
        assert_eq!(info.total_usdc, 1_050_0000000);
    }

    #[test]
    fn admin_pause_works_independently_of_leader() {
        let (env, _admin, _market, _usdc, factory, leader) = setup_with_usdc(1_000_0000000);
        let client = VaultFactoryContractClient::new(&env, &factory);
        let vault_id = client.create_vault(&leader, &String::from_str(&env, "alpha"));
        client.deposit(&leader, &vault_id, &200_0000000);
        client.admin_pause(&vault_id, &true);
        let info = client.get_vault(&vault_id);
        assert!(info.paused);
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
