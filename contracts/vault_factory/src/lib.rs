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
// Amounts use the <units>_<7 decimals> grouping (1_000_0000000 = 1000 USDC)
#![allow(clippy::inconsistent_digit_grouping)]
// Leader trade proxies mirror full market signatures
#![allow(clippy::too_many_arguments)]

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractimpl, contracttype, token, vec as svec, Address, BytesN, Env, IntoVal,
    String, Symbol, Vec,
};

use noether_common::types::{Order, OrderStatus, Position};

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
        if name.is_empty() || name.len() > 64 {
            return Err(FactoryError::InvalidName);
        }
        // L0-20 launch gate: optional leader allowlist (empty = permissionless)
        // + max-active-vaults cap (0 = unlimited).
        let allowlist = storage::get_leader_allowlist(&env);
        if !allowlist.is_empty() {
            let mut found = false;
            for i in 0..allowlist.len() {
                if allowlist.get(i).unwrap() == leader {
                    found = true;
                    break;
                }
            }
            if !found {
                return Err(FactoryError::CreationRestricted);
            }
        }
        let max = storage::get_max_vaults(&env);
        if max > 0 && storage::get_vault_list(&env).len() >= max {
            return Err(FactoryError::CreationRestricted);
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
        // V-4: price the deposit at FULL NAV (liquid + deployed), so a
        // depositor entering mid-trade neither gifts nor steals unrealized
        // PnL. Fail-closed if any leg can't be valued.
        let nav = full_nav(&env, &info)?;
        let shares = math::shares_for_deposit(amount, nav, info.circulating_shares)?;
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
        // V-4: value the burn at FULL NAV, then require the payout fit the
        // vault's LIQUID cash — capital tied up in open positions surfaces as
        // a distinct #17 LiquidityDeployed (wait for the leader to free it),
        // never a silent liquid-NAV haircut.
        let nav = full_nav(&env, &info)?;
        let usdc_out = math::usdc_for_withdraw(shares, nav, info.circulating_shares)?;
        if usdc_out > info.total_usdc {
            return Err(FactoryError::LiquidityDeployed);
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
            0i128, // acceptable_price = unbounded (L0-10 market arity)
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
        let bal_before = usdc_balance(&env);
        let position: Position =
            env.invoke_contract(&market, &Symbol::new(&env, "open_position"), open_args);
        let position_id = position.id;
        // Attribute only the USDC that left the factory for THIS open to this
        // vault (measured delta), then bind the position to the vault.
        credit_measured_delta(&env, &mut info, bal_before)?;
        storage::push_vault_position(&env, vault_id, position_id)?;
        storage::set_position_vault(&env, position_id, vault_id);
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
        // L0-20 isolation: a leader may only close THEIR vault's position.
        if storage::get_position_vault(&env, position_id) != Some(vault_id) {
            return Err(FactoryError::NotVaultPosition);
        }
        let market = storage::get_market(&env);
        let factory = env.current_contract_address();
        let args = svec![
            &env,
            factory.clone().into_val(&env),
            position_id.into_val(&env),
            0i128.into_val(&env), // acceptable_price = unbounded (L0-10 arity)
        ];
        // close_position is a direct call (auto-authorised) and only performs
        // market-internal transfers (from = market). Nothing deeper needs the
        // factory's auth. Settled equity lands at the factory address.
        let bal_before = usdc_balance(&env);
        let _: i128 = env.invoke_contract(&market, &Symbol::new(&env, "close_position"), args);
        credit_measured_delta(&env, &mut info, bal_before)?;
        storage::remove_vault_position(&env, vault_id, position_id);
        storage::remove_position_vault(&env, position_id);
        // Bumping HWM is not appropriate here; HWM moves only on claim.
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
        let bal_before = usdc_balance(&env);
        let order: Order = env.invoke_contract(&market, &Symbol::new(&env, "place_limit_order"), args);
        let order_id = order.id;
        // Limit orders lock collateral at the market immediately; measure it
        // and bind the order to the vault.
        credit_measured_delta(&env, &mut info, bal_before)?;
        storage::push_vault_order(&env, vault_id, order_id)?;
        storage::set_order_vault(&env, order_id, vault_id);
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
        // L0-20 isolation: a leader may only cancel THEIR vault's order.
        if storage::get_order_vault(&env, order_id) != Some(vault_id) {
            return Err(FactoryError::NotVaultPosition);
        }
        let market = storage::get_market(&env);
        let factory = env.current_contract_address();
        let args = svec![&env, factory.clone().into_val(&env), order_id.into_val(&env)];
        // Direct call — Soroban auto-authorises. cancel_order's internal
        // refund transfer has from=market so it needs no factory auth; the
        // refund lands at the factory address, measured here.
        let bal_before = usdc_balance(&env);
        env.invoke_contract::<()>(&market, &Symbol::new(&env, "cancel_order"), args);
        credit_measured_delta(&env, &mut info, bal_before)?;
        storage::remove_vault_order(&env, vault_id, order_id);
        storage::remove_order_vault(&env, order_id);
        storage::save_vault(&env, &info);
        env.events().publish(
            (Symbol::new(&env, "leader_cancel"), vault_id),
            (leader, order_id),
        );
        Ok(())
    }

    /// Reconcile a leader order the KEEPER resolved out-of-band (execution or
    /// cancellation happen via the keeper's execute_order, not a factory call,
    /// so the factory never saw the settlement). Permissionless and idempotent
    /// — the ownership map is dropped on success, so a second call → #16.
    /// - Executed → bind the resulting position to the vault (no cash moved:
    ///   the collateral was debited at placement and now lives as equity).
    /// - Cancelled/Slippage/Expired → credit order.collateral (the market's
    ///   refund landed at the factory address) back to the vault's liquid.
    /// - Pending → #3 (nothing to reconcile yet).
    pub fn reconcile_order(env: Env, vault_id: u32, order_id: u64) -> Result<(), FactoryError> {
        storage::require_initialized(&env)?;
        if storage::get_order_vault(&env, order_id) != Some(vault_id) {
            return Err(FactoryError::NotVaultPosition);
        }
        let market = storage::get_market(&env);
        let order = read_order(&env, &market, order_id).ok_or(FactoryError::InvalidParameter)?;

        let (position_id, credited): (u64, i128) = match order.status {
            OrderStatus::Executed => {
                if order.position_id == 0 {
                    return Err(FactoryError::InvalidParameter);
                }
                // Free the order slot first, then bind the position (net slot
                // count unchanged, so the cap can't spuriously reject).
                storage::remove_vault_order(&env, vault_id, order_id);
                storage::remove_order_vault(&env, order_id);
                storage::push_vault_position(&env, vault_id, order.position_id)?;
                storage::set_position_vault(&env, order.position_id, vault_id);
                (order.position_id, 0)
            }
            OrderStatus::Cancelled | OrderStatus::CancelledSlippage | OrderStatus::Expired => {
                let mut info = storage::load_vault(&env, vault_id)?;
                info.total_usdc = info
                    .total_usdc
                    .checked_add(order.collateral)
                    .ok_or(FactoryError::Overflow)?;
                storage::save_vault(&env, &info);
                storage::remove_vault_order(&env, vault_id, order_id);
                storage::remove_order_vault(&env, order_id);
                (0, order.collateral)
            }
            OrderStatus::Pending => return Err(FactoryError::InvalidParameter),
        };

        storage::extend_instance_ttl(&env);
        env.events().publish(
            (Symbol::new(&env, "order_reconciled"), vault_id),
            (order_id, position_id, credited),
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

        // V-4: profit is measured on FULL NAV above HWM, but the payout is
        // still capped at LIQUID cash (a claim can realize cash against
        // unrealized gains, bounded by the liquid cap + the HWM reset).
        let nav = full_nav(&env, &info)?;
        let owed = math::leader_profit_owed(
            nav,
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
        // Post-payout HWM = full NAV per share AFTER the payout (nav − owed).
        let new_nav = math::nav_per_share(nav - owed, info.circulating_shares)?;
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

    // ───────────────────────────────────────────────────────────────────
    // L0-20 views + admin controls
    // ───────────────────────────────────────────────────────────────────

    /// The vault that owns a position (None if not a factory position).
    pub fn get_position_vault(env: Env, position_id: u64) -> Option<u32> {
        storage::get_position_vault(&env, position_id)
    }

    /// The vault that owns a pending order (None if unknown/reconciled).
    pub fn get_order_vault(env: Env, order_id: u64) -> Option<u32> {
        storage::get_order_vault(&env, order_id)
    }

    /// Full NAV (liquid + deployed) for a vault — the true share basis.
    /// Fail-closed (#18) if any open position can't be valued.
    pub fn get_full_nav(env: Env, vault_id: u32) -> Result<i128, FactoryError> {
        let info = storage::load_vault(&env, vault_id)?;
        full_nav(&env, &info)
    }

    /// Admin: restrict who may create vaults (empty list = permissionless).
    pub fn set_leader_allowlist(env: Env, leaders: Vec<Address>) -> Result<(), FactoryError> {
        storage::require_admin(&env)?;
        storage::set_leader_allowlist(&env, &leaders);
        storage::extend_instance_ttl(&env);
        Ok(())
    }

    /// Admin: cap the number of vaults that can exist (0 = unlimited).
    pub fn set_max_vaults(env: Env, max: u32) -> Result<(), FactoryError> {
        storage::require_admin(&env)?;
        storage::set_max_vaults(&env, max);
        storage::extend_instance_ttl(&env);
        Ok(())
    }

    /// Admin in-place upgrade (the factory finally gets a migration path,
    /// mirroring market/vault/router). A disclosed admin power.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), FactoryError> {
        storage::require_admin(&env)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
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

/// The factory's live USDC balance (all vaults' liquid cash commingled at
/// the contract address — attribution is per-vault via measured deltas).
fn usdc_balance(env: &Env) -> i128 {
    let usdc_addr = storage::get_usdc(env);
    token::Client::new(env, &usdc_addr).balance(&env.current_contract_address())
}

/// L0-20 measured-settlement credit (replaces the old cross-vault-draining
/// whole-balance assignment). Attribute EXACTLY the USDC that moved for this
/// op to this vault — robust to fees/funding/PnL without replicating market
/// math, and immune to other vaults' idle cash. Pass the pre-invoke balance.
fn credit_measured_delta(env: &Env, info: &mut VaultInfo, bal_before: i128) -> Result<(), FactoryError> {
    let delta = usdc_balance(env) - bal_before;
    info.total_usdc = info.total_usdc.checked_add(delta).ok_or(FactoryError::Overflow)?;
    Ok(())
}

/// One position's mark-to-market equity via market.get_position_equity —
/// fail-closed: ANY market/oracle error maps to ValuationUnavailable so the
/// caller reverts rather than mispricing deployed capital.
fn read_position_equity(env: &Env, market: &Address, position_id: u64) -> Result<i128, FactoryError> {
    let args: Vec<soroban_sdk::Val> = (position_id,).into_val(env);
    match env.try_invoke_contract::<i128, soroban_sdk::Error>(
        market, &Symbol::new(env, "get_position_equity"), args,
    ) {
        Ok(Ok(equity)) => Ok(equity),
        _ => Err(FactoryError::ValuationUnavailable),
    }
}

/// Read a market order row (`Option<Order>`) — a pure storage read, no oracle.
fn read_order(env: &Env, market: &Address, order_id: u64) -> Option<Order> {
    let args: Vec<soroban_sdk::Val> = (order_id,).into_val(env);
    env.invoke_contract::<Option<Order>>(market, &Symbol::new(env, "get_order"), args)
}

/// L0-20 full NAV (V-4): liquid total_usdc + Σ open-position equity + Σ
/// PENDING-order collateral. Empty vault → liquid only (no cross-contract
/// reads, gas unchanged). Executed-but-unreconciled orders contribute 0 (a
/// brief conservative undercount closed by reconcile_order). Fail-closed:
/// any equity read error propagates ValuationUnavailable.
fn full_nav(env: &Env, info: &VaultInfo) -> Result<i128, FactoryError> {
    let positions = storage::get_vault_positions(env, info.id);
    let orders = storage::get_vault_orders(env, info.id);
    if positions.is_empty() && orders.is_empty() {
        return Ok(info.total_usdc);
    }
    let market = storage::get_market(env);
    let mut nav = info.total_usdc;
    for i in 0..positions.len() {
        let equity = read_position_equity(env, &market, positions.get(i).unwrap())?;
        nav = nav.checked_add(equity).ok_or(FactoryError::Overflow)?;
    }
    for i in 0..orders.len() {
        if let Some(order) = read_order(env, &market, orders.get(i).unwrap()) {
            if order.status == OrderStatus::Pending {
                nav = nav.checked_add(order.collateral).ok_or(FactoryError::Overflow)?;
            }
        }
    }
    Ok(nav)
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
    /// Return shapes MUST mirror the real market (`Position` from
    /// open_position, `i128` PnL from close_position): the factory
    /// decodes them via `invoke_contract::<Position>` / `::<i128>`.
    mod fake_market {
        use noether_common::types::{
            Direction, Order, OrderStatus, OrderType, Position, TriggerCondition,
        };
        use soroban_sdk::{contract, contracttype, contractimpl, token, Address, Env, Symbol};

        // Per-position/order state so the fake settles PER position (the real
        // market does) — a whole-balance refund would defeat the isolation
        // tests. Eq(id) is the settable mark-to-market equity for NAV tests.
        #[contracttype]
        pub enum FakeKey {
            Usdc,
            NextPid,
            NextOid,
            Pos(u64),
            Eq(u64),
            Ord(u64),
        }

        #[contract]
        pub struct FakeMarket;

        #[contractimpl]
        impl FakeMarket {
            pub fn init(env: Env, usdc: Address) {
                env.storage().instance().set(&FakeKey::Usdc, &usdc);
                env.storage().instance().set(&FakeKey::NextPid, &0u64);
                env.storage().instance().set(&FakeKey::NextOid, &0u64);
            }

            fn usdc(env: &Env) -> Address {
                env.storage().instance().get(&FakeKey::Usdc).unwrap()
            }

            pub fn open_position(
                env: Env,
                trader: Address,
                asset: Symbol,
                collateral: i128,
                leverage: u32,
                direction: Direction,
                _acceptable_price: i128,
            ) -> Position {
                trader.require_auth();
                let usdc = Self::usdc(&env);
                token::Client::new(&env, &usdc).transfer(
                    &trader, &env.current_contract_address(), &collateral,
                );
                let mut id: u64 = env.storage().instance().get(&FakeKey::NextPid).unwrap_or(0);
                id += 1;
                env.storage().instance().set(&FakeKey::NextPid, &id);
                let pos = Position {
                    id, trader, asset, collateral,
                    size: collateral * leverage as i128,
                    entry_price: 50_000_0000000, direction, leverage,
                    liquidation_price: 0, timestamp: env.ledger().timestamp(),
                    entry_cumulative_funding: 0, margin_mode: 0,
                };
                env.storage().persistent().set(&FakeKey::Pos(id), &pos);
                env.storage().persistent().set(&FakeKey::Eq(id), &collateral);
                pos
            }

            pub fn close_position(env: Env, trader: Address, position_id: u64, _acceptable_price: i128) -> i128 {
                trader.require_auth();
                let usdc = Self::usdc(&env);
                let market_addr = env.current_contract_address();
                let pos: Position = env.storage().persistent().get(&FakeKey::Pos(position_id)).unwrap();
                let equity: i128 = env.storage().persistent().get(&FakeKey::Eq(position_id)).unwrap_or(pos.collateral);
                // Settle ONLY this position (capped at the market's balance).
                let bal = token::Client::new(&env, &usdc).balance(&market_addr);
                let payout = if equity > bal { bal } else { equity };
                if payout > 0 {
                    token::Client::new(&env, &usdc).transfer(&market_addr, &trader, &payout);
                }
                env.storage().persistent().remove(&FakeKey::Pos(position_id));
                env.storage().persistent().remove(&FakeKey::Eq(position_id));
                equity - pos.collateral
            }

            #[allow(clippy::too_many_arguments)]
            pub fn place_limit_order(
                env: Env, trader: Address, asset: Symbol, direction: Direction,
                collateral: i128, leverage: u32, trigger_price: i128,
                _trigger_above: bool, slippage_tolerance_bps: u32, time_in_force: u32,
            ) -> Order {
                trader.require_auth();
                let usdc = Self::usdc(&env);
                token::Client::new(&env, &usdc).transfer(
                    &trader, &env.current_contract_address(), &collateral,
                );
                let mut id: u64 = env.storage().instance().get(&FakeKey::NextOid).unwrap_or(0);
                id += 1;
                env.storage().instance().set(&FakeKey::NextOid, &id);
                let order = Order {
                    id, trader, asset, order_type: OrderType::LimitEntry, direction,
                    collateral, leverage, trigger_price,
                    trigger_condition: TriggerCondition::Below, slippage_tolerance_bps,
                    position_id: 0, has_position: false, created_at: env.ledger().timestamp(),
                    status: OrderStatus::Pending, limit_price: 0, trailing_percent_bps: 0,
                    time_in_force, stop_limit_phase: 0,
                };
                env.storage().persistent().set(&FakeKey::Ord(id), &order);
                order
            }

            pub fn cancel_order(env: Env, trader: Address, order_id: u64) {
                trader.require_auth();
                let usdc = Self::usdc(&env);
                let market_addr = env.current_contract_address();
                let mut order: Order = env.storage().persistent().get(&FakeKey::Ord(order_id)).unwrap();
                if order.collateral > 0 {
                    token::Client::new(&env, &usdc).transfer(&market_addr, &trader, &order.collateral);
                }
                order.status = OrderStatus::Cancelled;
                env.storage().persistent().set(&FakeKey::Ord(order_id), &order);
            }

            pub fn get_order(env: Env, order_id: u64) -> Option<Order> {
                env.storage().persistent().get(&FakeKey::Ord(order_id))
            }

            pub fn get_position(env: Env, position_id: u64) -> Option<Position> {
                env.storage().persistent().get(&FakeKey::Pos(position_id))
            }

            pub fn get_position_equity(env: Env, position_id: u64) -> i128 {
                env.storage().persistent().get(&FakeKey::Eq(position_id)).unwrap_or(0)
            }

            // ── test-only: simulate market PnL + keeper order execution ──
            pub fn set_equity(env: Env, position_id: u64, equity: i128) {
                env.storage().persistent().set(&FakeKey::Eq(position_id), &equity);
            }

            pub fn exec_order(env: Env, order_id: u64) -> u64 {
                let mut order: Order = env.storage().persistent().get(&FakeKey::Ord(order_id)).unwrap();
                let mut pid: u64 = env.storage().instance().get(&FakeKey::NextPid).unwrap_or(0);
                pid += 1;
                env.storage().instance().set(&FakeKey::NextPid, &pid);
                let pos = Position {
                    id: pid, trader: order.trader.clone(), asset: order.asset.clone(),
                    collateral: order.collateral, size: order.collateral * order.leverage as i128,
                    entry_price: 50_000_0000000, direction: order.direction, leverage: order.leverage,
                    liquidation_price: 0, timestamp: env.ledger().timestamp(),
                    entry_cumulative_funding: 0, margin_mode: 0,
                };
                env.storage().persistent().set(&FakeKey::Pos(pid), &pos);
                env.storage().persistent().set(&FakeKey::Eq(pid), &order.collateral);
                order.status = OrderStatus::Executed;
                order.position_id = pid;
                env.storage().persistent().set(&FakeKey::Ord(order_id), &order);
                pid
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
        // Model a +50 USDC PnL: the position's equity is now 250, and the
        // market is funded to pay it. leader_close credits the measured delta.
        market.set_equity(&position_id, &250_0000000);
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

    // ───────────────────────────────────────────────────────────────────
    // L0-20 · fund isolation (V-1) + full-NAV valuation (V-4)
    // ───────────────────────────────────────────────────────────────────

    /// Factory + real fake-market + USDC, both initialized.
    fn ff() -> (Env, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);
        let factory_id = env.register_contract(None, VaultFactoryContract);
        let admin = Address::generate(&env);
        let usdc_id = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let market_id = env.register_contract(None, fake_market::FakeMarket);
        let factory = VaultFactoryContractClient::new(&env, &factory_id);
        factory.initialize(&admin, &market_id, &usdc_id);
        fake_market::FakeMarketClient::new(&env, &market_id).init(&usdc_id);
        (env, factory_id, market_id, usdc_id, admin)
    }

    fn mint(env: &Env, usdc_id: &Address, to: &Address, amt: i128) {
        soroban_sdk::token::StellarAssetClient::new(env, usdc_id).mint(to, &amt);
    }

    #[test]
    fn two_vaults_isolated_accounting() {
        // V-1: a leader op on vault A must NOT re-attribute vault B's cash.
        let (env, factory_id, _m, usdc_id, _admin) = ff();
        let factory = VaultFactoryContractClient::new(&env, &factory_id);
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        mint(&env, &usdc_id, &a, 2_000_0000000);
        mint(&env, &usdc_id, &b, 2_000_0000000);
        let va = factory.create_vault(&a, &String::from_str(&env, "A"));
        let vb = factory.create_vault(&b, &String::from_str(&env, "B"));
        factory.deposit(&a, &va, &1_000_0000000);
        factory.deposit(&b, &vb, &1_000_0000000);

        factory.leader_open_position(&a, &va, &Symbol::new(&env, "BTC"), &200_0000000, &5u32, &0u32);

        assert_eq!(factory.get_vault(&va).total_usdc, 800_0000000, "A debited its own 200");
        assert_eq!(factory.get_vault(&vb).total_usdc, 1_000_0000000, "B untouched (V-1)");
    }

    #[test]
    fn cross_vault_close_rejected() {
        let (env, factory_id, _m, usdc_id, _admin) = ff();
        let factory = VaultFactoryContractClient::new(&env, &factory_id);
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        mint(&env, &usdc_id, &a, 2_000_0000000);
        mint(&env, &usdc_id, &b, 2_000_0000000);
        let va = factory.create_vault(&a, &String::from_str(&env, "A"));
        let vb = factory.create_vault(&b, &String::from_str(&env, "B"));
        factory.deposit(&a, &va, &1_000_0000000);
        factory.deposit(&b, &vb, &1_000_0000000);
        let pid = factory.leader_open_position(&a, &va, &Symbol::new(&env, "BTC"), &200_0000000, &5u32, &0u32);

        // Leader B cannot close A's position.
        assert!(matches!(
            factory.try_leader_close_position(&b, &vb, &pid),
            Err(Ok(FactoryError::NotVaultPosition))
        ));
        // The rightful owner can.
        factory.leader_close_position(&a, &va, &pid);
        assert_eq!(factory.get_position_vault(&pid), None);
    }

    #[test]
    fn cross_vault_cancel_rejected() {
        let (env, factory_id, _m, usdc_id, _admin) = ff();
        let factory = VaultFactoryContractClient::new(&env, &factory_id);
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        mint(&env, &usdc_id, &a, 2_000_0000000);
        mint(&env, &usdc_id, &b, 2_000_0000000);
        let va = factory.create_vault(&a, &String::from_str(&env, "A"));
        let vb = factory.create_vault(&b, &String::from_str(&env, "B"));
        factory.deposit(&a, &va, &1_000_0000000);
        factory.deposit(&b, &vb, &1_000_0000000);
        let oid = factory.leader_place_limit_order(
            &a, &va, &Symbol::new(&env, "BTC"), &200_0000000, &5u32, &0u32,
            &50_000_0000000, &false, &100u32,
        );

        assert!(matches!(
            factory.try_leader_cancel_order(&b, &vb, &oid),
            Err(Ok(FactoryError::NotVaultPosition))
        ));
        factory.leader_cancel_order(&a, &va, &oid);
        assert_eq!(factory.get_order_vault(&oid), None);
    }

    #[test]
    fn nav_prices_open_position_upnl() {
        // V-4: full NAV includes deployed collateral marked to market.
        let (env, factory_id, market_id, usdc_id, _admin) = ff();
        let factory = VaultFactoryContractClient::new(&env, &factory_id);
        let market = fake_market::FakeMarketClient::new(&env, &market_id);
        let a = Address::generate(&env);
        mint(&env, &usdc_id, &a, 2_000_0000000);
        let va = factory.create_vault(&a, &String::from_str(&env, "A"));
        factory.deposit(&a, &va, &1_000_0000000);
        let pid = factory.leader_open_position(&a, &va, &Symbol::new(&env, "BTC"), &200_0000000, &5u32, &0u32);

        assert_eq!(factory.get_full_nav(&va), 1_000_0000000, "liquid 800 + equity 200");
        market.set_equity(&pid, &250_0000000); // +50 uPnL
        assert_eq!(factory.get_full_nav(&va), 1_050_0000000, "NAV rises with the mark");
    }

    #[test]
    fn deposit_mid_trade_mints_fair_shares() {
        // V-4 exploit regression: entering while the leader sits on unrealized
        // gains must value those gains — no instant share-price steal.
        let (env, factory_id, market_id, usdc_id, _admin) = ff();
        let factory = VaultFactoryContractClient::new(&env, &factory_id);
        let market = fake_market::FakeMarketClient::new(&env, &market_id);
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        mint(&env, &usdc_id, &a, 2_000_0000000);
        mint(&env, &usdc_id, &b, 2_000_0000000);
        let va = factory.create_vault(&a, &String::from_str(&env, "A"));
        factory.deposit(&a, &va, &1_000_0000000); // 1000 shares
        let pid = factory.leader_open_position(&a, &va, &Symbol::new(&env, "BTC"), &800_0000000, &5u32, &0u32);
        market.set_equity(&pid, &1_000_0000000); // +200 uPnL → full NAV 200 liquid + 1000 = 1200

        // 600 deposit at NAV 1.2 mints 600*1000/1200 = 500 shares (NOT 3000 at liquid-only).
        let shares = factory.deposit(&b, &va, &600_0000000);
        assert_eq!(shares, 500_0000000);
    }

    #[test]
    fn withdraw_exceeding_liquid_fails_liquidity_deployed() {
        let (env, factory_id, _m, usdc_id, _admin) = ff();
        let factory = VaultFactoryContractClient::new(&env, &factory_id);
        let a = Address::generate(&env);
        mint(&env, &usdc_id, &a, 2_000_0000000);
        let va = factory.create_vault(&a, &String::from_str(&env, "A"));
        factory.deposit(&a, &va, &1_000_0000000);
        factory.leader_open_position(&a, &va, &Symbol::new(&env, "BTC"), &900_0000000, &5u32, &0u32); // liquid 100

        // 500 shares priced at NAV 1.0 = 500 USDC > liquid 100 → #17, not a haircut.
        assert!(matches!(
            factory.try_withdraw(&a, &va, &500_0000000),
            Err(Ok(FactoryError::LiquidityDeployed))
        ));
    }

    #[test]
    fn reconcile_executed_order_binds_position() {
        let (env, factory_id, market_id, usdc_id, _admin) = ff();
        let factory = VaultFactoryContractClient::new(&env, &factory_id);
        let market = fake_market::FakeMarketClient::new(&env, &market_id);
        let a = Address::generate(&env);
        mint(&env, &usdc_id, &a, 2_000_0000000);
        let va = factory.create_vault(&a, &String::from_str(&env, "A"));
        factory.deposit(&a, &va, &1_000_0000000);
        let oid = factory.leader_place_limit_order(
            &a, &va, &Symbol::new(&env, "BTC"), &200_0000000, &5u32, &0u32,
            &50_000_0000000, &false, &100u32,
        );
        let pid = market.exec_order(&oid); // keeper executes out-of-band

        factory.reconcile_order(&va, &oid);
        assert_eq!(factory.get_position_vault(&pid), Some(va));
        assert_eq!(factory.get_order_vault(&oid), None);
        // Idempotent: a second reconcile finds no mapping → #16.
        assert!(matches!(
            factory.try_reconcile_order(&va, &oid),
            Err(Ok(FactoryError::NotVaultPosition))
        ));
    }

    #[test]
    fn reconcile_cancelled_order_credits_collateral() {
        let (env, factory_id, market_id, usdc_id, _admin) = ff();
        let factory = VaultFactoryContractClient::new(&env, &factory_id);
        let market = fake_market::FakeMarketClient::new(&env, &market_id);
        let a = Address::generate(&env);
        mint(&env, &usdc_id, &a, 2_000_0000000);
        let va = factory.create_vault(&a, &String::from_str(&env, "A"));
        factory.deposit(&a, &va, &1_000_0000000);
        let oid = factory.leader_place_limit_order(
            &a, &va, &Symbol::new(&env, "BTC"), &200_0000000, &5u32, &0u32,
            &50_000_0000000, &false, &100u32,
        );
        assert_eq!(factory.get_vault(&va).total_usdc, 800_0000000, "200 locked in the order");

        // Keeper cancels out-of-band: the market refunds 200 to the factory
        // with no factory call, so total_usdc is stale until reconcile.
        market.cancel_order(&factory_id, &oid);
        factory.reconcile_order(&va, &oid);

        assert_eq!(factory.get_vault(&va).total_usdc, 1_000_0000000, "refund credited");
        assert_eq!(factory.get_order_vault(&oid), None);
    }

    #[test]
    fn invariant_sum_vault_totals_equals_factory_balance() {
        let (env, factory_id, _m, usdc_id, _admin) = ff();
        let factory = VaultFactoryContractClient::new(&env, &factory_id);
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        mint(&env, &usdc_id, &a, 2_000_0000000);
        mint(&env, &usdc_id, &b, 2_000_0000000);
        let va = factory.create_vault(&a, &String::from_str(&env, "A"));
        let vb = factory.create_vault(&b, &String::from_str(&env, "B"));
        factory.deposit(&a, &va, &1_000_0000000);
        factory.deposit(&b, &vb, &1_000_0000000);
        factory.leader_open_position(&a, &va, &Symbol::new(&env, "BTC"), &200_0000000, &5u32, &0u32);

        let sum = factory.get_vault(&va).total_usdc + factory.get_vault(&vb).total_usdc;
        let factory_bal = soroban_sdk::token::Client::new(&env, &usdc_id).balance(&factory_id);
        assert_eq!(sum, factory_bal, "Σ vault totals == factory balance (invariant A)");
    }

    #[test]
    fn claim_uses_full_nav_capped_by_liquid() {
        let (env, factory_id, market_id, usdc_id, _admin) = ff();
        let factory = VaultFactoryContractClient::new(&env, &factory_id);
        let market = fake_market::FakeMarketClient::new(&env, &market_id);
        let a = Address::generate(&env);
        mint(&env, &usdc_id, &a, 2_000_0000000);
        let va = factory.create_vault(&a, &String::from_str(&env, "A"));
        factory.deposit(&a, &va, &1_000_0000000); // 1000 shares, HWM 1.0
        let pid = factory.leader_open_position(&a, &va, &Symbol::new(&env, "BTC"), &500_0000000, &5u32, &0u32);
        market.set_equity(&pid, &700_0000000); // +200 uPnL → full NAV 1200, per-share 1.2

        // Profit share = 200 gain × 10% = 20 USDC, paid from liquid 500.
        let owed = factory.claim_leader_fees(&va);
        assert_eq!(owed, 20_0000000, "owed measured on FULL NAV, not liquid-only");
        assert_eq!(factory.get_vault(&va).total_usdc, 480_0000000);
    }

    #[test]
    fn create_vault_allowlist_and_cap_enforced() {
        let (env, factory_id, _m, _usdc, _admin) = ff();
        let factory = VaultFactoryContractClient::new(&env, &factory_id);
        let a = Address::generate(&env);
        let b = Address::generate(&env);

        // Allowlist = [a]: b is refused.
        factory.set_leader_allowlist(&svec![&env, a.clone()]);
        factory.create_vault(&a, &String::from_str(&env, "A"));
        assert!(matches!(
            factory.try_create_vault(&b, &String::from_str(&env, "B")),
            Err(Ok(FactoryError::CreationRestricted))
        ));

        // Permissionless again but capped at 1 (one already exists).
        factory.set_leader_allowlist(&Vec::new(&env));
        factory.set_max_vaults(&1u32);
        assert!(matches!(
            factory.try_create_vault(&a, &String::from_str(&env, "C")),
            Err(Ok(FactoryError::CreationRestricted))
        ));
    }

    #[test]
    fn too_many_open_slots_rejected() {
        let (env, factory_id, _m, usdc_id, _admin) = ff();
        let factory = VaultFactoryContractClient::new(&env, &factory_id);
        let a = Address::generate(&env);
        mint(&env, &usdc_id, &a, 5_000_0000000);
        let va = factory.create_vault(&a, &String::from_str(&env, "A"));
        factory.deposit(&a, &va, &1_000_0000000);
        let btc = Symbol::new(&env, "BTC");

        for _ in 0..16 {
            factory.leader_open_position(&a, &va, &btc, &10_0000000, &2u32, &0u32);
        }
        assert!(matches!(
            factory.try_leader_open_position(&a, &va, &btc, &10_0000000, &2u32, &0u32),
            Err(Ok(FactoryError::TooManyOpenSlots))
        ));
    }
}
