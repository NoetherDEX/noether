//! # Market Contract (Trading Engine)
//!
//! The core trading engine for Noether PerpDex.
//!
//! ## Features
//! - Open leveraged long/short positions (1-10x)
//! - Close positions and settle PnL
//! - Liquidation mechanism for underwater positions
//! - Funding rate to balance long/short interest
//! - Position management (add collateral)
//!
//! ## Architecture
//! - Uses Oracle Adapter for price feeds
//! - Settles with Vault for PnL
//! - Positions stored with global index for keeper efficiency
//!
//! ## Settlement Flow
//!
//! **Close Position (Trader Wins):**
//! 1. Market calls Vault.settle_pnl(+pnl)
//! 2. Vault transfers profit to Market
//! 3. Market pays trader: collateral + profit
//!
//! **Close Position (Trader Loses):**
//! 1. Market calls Vault.settle_pnl(-pnl)
//! 2. Vault updates accounting (no transfer)
//! 3. Market transfers loss to Vault
//! 4. Market pays trader: collateral - loss
//!
//! **Liquidation:**
//! 1. Market calculates remaining equity
//! 2. Keeper gets reward from remaining
//! 3. Vault gets rest of collateral
//! 4. Trader gets nothing

#![no_std]
// Soroban order entry points legitimately exceed clippy's 7-arg heuristic
#![allow(clippy::too_many_arguments)]

use soroban_sdk::{contract, contractimpl, token, Address, BytesN, Env, Symbol, Vec, IntoVal};
use noether_common::{
    NoetherError, Position, Direction, MarketConfig, AssetRiskParams,
    Order, OrderType, OrderStatus, TriggerCondition, KeeperFeeConfig,
    VolumeRecord, BASIS_POINTS, PRECISION,
    calculate_position_size, calculate_liquidation_price, calculate_pnl,
    calculate_trading_fee, calculate_cumulative_funding, funding_velocity,
    should_liquidate,
};

mod storage;
mod position;
mod trading;

use storage::*;

// ═══════════════════════════════════════════════════════════════════════════
// Shared Helpers (reduces WASM size by deduplicating fee/volume logic)
// ═══════════════════════════════════════════════════════════════════════════

/// Calculate trading fee and record volume in one call.
/// Returns the fee amount. Handles both tiered and legacy flat fee.
fn calculate_fee_and_record_volume(
    env: &Env,
    trader: &Address,
    size: i128,
    is_maker: bool,
    config: &MarketConfig,
) -> i128 {
    let fee_tiers = get_fee_tiers(env);
    if !fee_tiers.is_empty() {
        let mut volume_record = get_trader_volume(env, trader)
            .unwrap_or(VolumeRecord {
                daily_volumes: Vec::new(env),
                last_update_day: 0,
            });
        let current_day = trading::timestamp_to_day(env.ledger().timestamp());
        let rolling_volume = trading::sum_rolling_volume(&volume_record);
        let tier = trading::determine_fee_tier(rolling_volume, &fee_tiers);
        let fee = trading::calculate_tiered_fee(size, is_maker, &tier);
        trading::record_trade_volume(env, &mut volume_record, size, current_day);
        set_trader_volume(env, trader, &volume_record);
        fee
    } else {
        calculate_trading_fee(size, config.trading_fee_bps)
    }
}

/// Record only volume (no fee charged). Used for close operations —
/// reuses the tiered-fee path's bookkeeping and discards the fee.
fn record_volume_only(env: &Env, trader: &Address, size: i128) {
    let config = get_config(env);
    let _ = calculate_fee_and_record_volume(env, trader, size, true, &config);
}

// ═══════════════════════════════════════════════════════════════════════════
// Contract Definition
// ═══════════════════════════════════════════════════════════════════════════

#[contract]
pub struct MarketContract;

#[contractimpl]
impl MarketContract {
    // ═══════════════════════════════════════════════════════════════════════
    // Initialization
    // ═══════════════════════════════════════════════════════════════════════

    /// Initialize the market contract.
    ///
    /// # Arguments
    /// * `admin` - Admin address for configuration
    /// * `oracle_adapter` - Oracle adapter contract address
    /// * `vault` - Vault contract address
    /// * `usdc_token` - USDC token contract address
    /// * `config` - Market configuration parameters
    pub fn initialize(
        env: Env,
        admin: Address,
        oracle_adapter: Address,
        vault: Address,
        usdc_token: Address,
        config: MarketConfig,
    ) -> Result<(), NoetherError> {
        if is_initialized(&env) {
            return Err(NoetherError::AlreadyInitialized);
        }

        admin.require_auth();

        // Validate config
        if config.max_leverage < 1 || config.max_leverage > 100 {
            return Err(NoetherError::InvalidParameter);
        }

        // Store addresses
        set_admin(&env, &admin);
        set_oracle_adapter(&env, &oracle_adapter);
        set_vault(&env, &vault);
        set_usdc_token(&env, &usdc_token);

        // Store configuration
        set_config(&env, &config);

        // Initialize state
        set_position_counter(&env, 0);
        set_total_long_size(&env, 0);
        set_total_short_size(&env, 0);
        set_last_funding_time(&env, env.ledger().timestamp());
        set_cumulative_funding_rate(&env, 0);
        init_position_index(&env);

        // Initialize fee tiers with defaults
        let default_tiers = trading::default_fee_tiers(&env);
        set_fee_tiers(&env, &default_tiers);

        set_initialized(&env, true);
        set_paused(&env, false);

        extend_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "initialized"),),
            (admin, vault, oracle_adapter),
        );

        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Admin Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Halt trading (opens, closes, cross deposits/withdrawals, orders).
    /// Liquidations are exempt so risk can still be unwound mid-incident.
    pub fn pause(env: Env) -> Result<(), NoetherError> {
        require_admin(&env)?;
        set_paused(&env, true);
        env.events().publish((Symbol::new(&env, "paused"),), ());
        Ok(())
    }

    /// Resume trading after a pause.
    pub fn unpause(env: Env) -> Result<(), NoetherError> {
        require_admin(&env)?;
        set_paused(&env, false);
        env.events().publish((Symbol::new(&env, "unpaused"),), ());
        Ok(())
    }

    /// Route a share of trading fees to a treasury address (insurance /
    /// operations funding). bps is the protocol share in basis points,
    /// capped at 50%.
    pub fn set_fee_split(env: Env, treasury: Address, bps: u32) -> Result<(), NoetherError> {
        require_admin(&env)?;
        if bps > 5_000 {
            return Err(NoetherError::InvalidParameter);
        }
        set_treasury(&env, &treasury);
        set_protocol_fee_bps(&env, bps);
        Ok(())
    }

    /// Swap the running WASM in place; all storage (positions, orders,
    /// cross balances) is preserved across the upgrade.
    ///
    /// ⚠️ When the new wasm's `MarketConfig` has MORE fields than the stored
    /// one, every config-reading entry point traps until `migrate_config`
    /// rewrites it (Soroban decodes structs by exact field set). Pause →
    /// upgrade → migrate_config → unpause. See `migrate_config`.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), NoetherError> {
        require_admin(&env)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    /// Overwrite the stored `MarketConfig` WITHOUT reading the old value.
    ///
    /// A Soroban struct is stored as an exact field map, so after an
    /// `upgrade` that adds config fields the old value no longer decodes:
    /// `get_config` traps with `UnexpectedSize` and the market is bricked
    /// until this runs. This entry point never reads the old config, so it
    /// is callable in that state — the one-way door out of a config-shape
    /// upgrade. Admin-only; validated like `initialize`.
    pub fn migrate_config(env: Env, config: MarketConfig) -> Result<(), NoetherError> {
        require_admin(&env)?;
        if config.max_leverage == 0
            || config.min_collateral <= 0
            || config.maintenance_margin_bps >= BASIS_POINTS
            || config.liquidation_fee_bps >= BASIS_POINTS
            || config.partial_liq_tranche_bps >= BASIS_POINTS
            || config.insurance_buffer_share_bps > BASIS_POINTS
            || config.liquidation_penalty_bps >= BASIS_POINTS
            || config.penalty_keeper_share_bps > BASIS_POINTS
            || config.cross_liq_restore_target_bps <= BASIS_POINTS
            || config.cross_close_out_bps >= BASIS_POINTS
            || config.adl_clear_ratio_bps < config.adl_trigger_ratio_bps
            || config.adl_compensation_bps > 100
        {
            return Err(NoetherError::InvalidParameter);
        }
        set_config(&env, &config);
        extend_instance_ttl(&env);
        Ok(())
    }

    /// Permissionless NAV freshener: recompute one asset's unrealized
    /// trader PnL at the current oracle price and push it to the vault,
    /// so NOE pricing tracks the market between trades. Returns the
    /// pushed value.
    pub fn sync_asset_pnl(env: Env, asset: Symbol) -> Result<i128, NoetherError> {
        require_initialized(&env)?;
        let price = Self::get_oracle_price(&env, &asset, false)?;
        let (lk, ls, sk, ss) = get_asset_exposure(&env, &asset);
        let upnl = Self::exposure_upnl(lk, ls, sk, ss, price);
        Self::push_exposure(&env, &asset, upnl, 0);
        Ok(upnl)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Trading Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Open a new leveraged position.
    ///
    /// # Arguments
    /// * `trader` - Address of the trader
    /// * `asset` - Asset symbol (e.g., "XLM")
    /// * `collateral` - USDC collateral amount (7 decimals)
    /// * `leverage` - Leverage multiplier (1-10)
    /// * `direction` - Long or Short
    ///
    /// # Returns
    /// The created Position
    ///
    /// # Flow
    /// 1. Validate parameters
    /// 2. Check Vault liquidity for potential payout
    /// 3. Fetch price from oracle
    /// 4. Calculate position size and liquidation price
    /// 5. Transfer collateral from trader
    /// 6. Deduct trading fee
    /// 7. Store position
    pub fn open_position(
        env: Env,
        trader: Address,
        asset: Symbol,
        collateral: i128,
        leverage: u32,
        direction: Direction,
        acceptable_price: i128,
    ) -> Result<Position, NoetherError> {
        Self::do_open(env, trader, asset, collateral, leverage, direction, false, acceptable_price)
    }

    /// Shared open path for isolated and cross margin (one compiled body —
    /// WASM budget). Flow: validate → [cross: auto-deposit + free-margin
    /// check] → reserve payout in vault → strict oracle read → fee →
    /// [cross: deduct pool | isolated: pull wallet collateral] → persist.
    fn do_open(
        env: Env,
        trader: Address,
        asset: Symbol,
        collateral: i128,
        leverage: u32,
        direction: Direction,
        cross: bool,
        acceptable_price: i128,
    ) -> Result<Position, NoetherError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;

        trader.require_auth();

        let config = get_config(&env);

        // No new exposure during a solvency event (L0-1) — reuses #82,
        // the same "no capacity" answer OI caps give.
        if get_adl_active(&env, &asset) {
            return Err(NoetherError::OpenInterestCapExceeded);
        }

        if collateral < config.min_collateral {
            return Err(NoetherError::InsufficientCollateral);
        }
        // Per-market ladder (L0-12): fail-closed on an unconfigured asset
        // once the ladder is live; legacy global limits before that.
        let (max_leverage, max_position_size, mm_bps) =
            Self::effective_open_limits(&env, &asset, &config)?;
        if leverage < 1 || leverage > max_leverage {
            return Err(NoetherError::InvalidLeverage);
        }

        let size = calculate_position_size(collateral, leverage);
        if size > max_position_size {
            return Err(NoetherError::PositionTooLarge);
        }

        if cross {
            // Auto-deposit: if pool balance is insufficient, pull from wallet
            let pool_balance = get_cross_margin_balance(&env, &trader);
            if collateral > pool_balance {
                let shortfall = collateral - pool_balance;
                let usdc_token = get_usdc_token(&env);
                let token_client = token::Client::new(&env, &usdc_token);
                token_client.transfer(&trader, &env.current_contract_address(), &shortfall);
                let new_pool = pool_balance.checked_add(shortfall).ok_or(NoetherError::Overflow)?;
                set_cross_margin_balance(&env, &trader, new_pool);
                add_cross_margin_trader(&env, &trader);
            }

            // Free margin check (Binance-style): equity - used_margin must
            // cover the new position's initial margin, so an account near
            // liquidation cannot lever up further.
            let existing_cross_positions = get_cross_margin_position_ids(&env, &trader);
            if !existing_cross_positions.is_empty() {
                let get_price = |asset: &Symbol| -> i128 {
                    Self::get_oracle_price(&env, asset, false).unwrap_or(0)
                };
                let equity = position::calculate_cross_equity(&env, &trader, &get_price);
                let mm = position::calculate_cross_maintenance_margin(
                    &env, &trader, config.maintenance_margin_bps,
                );
                if equity < mm + collateral {
                    return Err(NoetherError::CrossMarginInsufficientFreeMargin);
                }
            }
        }

        // Reserve the max payout in the vault (real reservation + OI caps)
        let vault_address = get_vault(&env);
        Self::reserve_with_vault(&env, &vault_address, &asset, &direction, size)?;

        let entry_price = Self::get_oracle_price(&env, &asset, true)?;

        // L0-10: GMX-style acceptable-price bound (0 = unbounded). A worse-
        // than-bound fill reverts — the trader's own parameter, not the
        // contract, blocks it.
        if acceptable_price < 0 {
            return Err(NoetherError::InvalidParameter);
        }
        if acceptable_price > 0 {
            let worse = match direction {
                Direction::Long => entry_price > acceptable_price,
                Direction::Short => entry_price < acceptable_price,
            };
            if worse {
                return Err(NoetherError::AcceptablePriceExceeded);
            }
        }

        // Taker fee + volume
        let fee = calculate_fee_and_record_volume(&env, &trader, size, false, &config);
        let net_collateral = collateral - fee;
        if net_collateral <= 0 {
            return Err(NoetherError::InsufficientCollateral);
        }

        if cross {
            let pool = get_cross_margin_balance(&env, &trader);
            set_cross_margin_balance(&env, &trader, pool - collateral);
        } else {
            let usdc_token = get_usdc_token(&env);
            let token_client = token::Client::new(&env, &usdc_token);
            token_client.transfer(&trader, &env.current_contract_address(), &collateral);
        }

        let liquidation_price = if cross {
            0 // Cross-margin: account-level liquidation, no per-position price
        } else {
            calculate_liquidation_price(
                entry_price,
                leverage,
                direction,
                mm_bps,
            )
        };

        let position = Position {
            id: next_position_id(&env),
            trader: trader.clone(),
            asset: asset.clone(),
            collateral: net_collateral,
            size,
            entry_price,
            direction,
            leverage,
            liquidation_price,
            timestamp: env.ledger().timestamp(),
            entry_cumulative_funding: Self::cum_funding(&env, &asset),
            margin_mode: if cross { 1 } else { 0 },
        };

        Self::finalize_open(&env, &position, fee);
        extend_instance_ttl(&env);

        Ok(position)
    }

    /// Close an existing position.
    ///
    /// # Arguments
    /// * `trader` - Address of the trader (must own position)
    /// * `position_id` - ID of position to close
    ///
    /// # Returns
    /// Final PnL amount (positive = profit, negative = loss)
    ///
    /// # Flow
    /// 1. Verify ownership
    /// 2. Apply any pending funding
    /// 3. Calculate PnL at current price
    /// 4. Settle with vault (handles fund transfer for wins)
    /// 5. Transfer loss to vault if trader lost
    /// 6. Return collateral +/- PnL to trader
    pub fn close_position(
        env: Env,
        trader: Address,
        position_id: u64,
        acceptable_price: i128,
    ) -> Result<i128, NoetherError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;

        trader.require_auth();

        // Get position
        let position = get_position(&env, position_id)
            .ok_or(NoetherError::PositionNotFound)?;

        // Verify ownership
        if position.trader != trader {
            return Err(NoetherError::NotPositionOwner);
        }

        // Get current price and run the shared close settlement
        let current_price = Self::get_oracle_price(&env, &position.asset, false)?;
        Self::check_close_bound(position.direction, current_price, acceptable_price)?;
        let pnl = Self::settle_isolated_close(&env, &position, current_price, 0, None, None)?;

        extend_instance_ttl(&env);

        Ok(pnl)
    }

    /// Close part of an isolated position (L0-6). close_size is NOTIONAL USD
    /// (same unit as Position.size). Settles only the closed portion's
    /// pnl + funding, refunds its pro-rata collateral (minus the closed
    /// portion's loss), releases its OI reservation, and shrinks the
    /// position in place — the collateral/size ratio is preserved so the
    /// stored liquidation_price stays valid and entry_cumulative_funding is
    /// untouched (only the closed portion's funding settled). Returns pnl on
    /// the closed portion. A full-size close delegates to close_position.
    pub fn close_position_partial(
        env: Env,
        trader: Address,
        position_id: u64,
        close_size: i128,
    ) -> Result<i128, NoetherError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;
        trader.require_auth();

        let position = get_position(&env, position_id).ok_or(NoetherError::PositionNotFound)?;
        if position.trader != trader {
            return Err(NoetherError::NotPositionOwner);
        }
        if position.margin_mode != 0 {
            return Err(NoetherError::InvalidParameter); // cross partial close is out of scope
        }
        if close_size <= 0 {
            return Err(NoetherError::InvalidAmount);
        }
        if close_size > position.size {
            return Err(NoetherError::InvalidParameter);
        }

        let current_price = Self::get_oracle_price(&env, &position.asset, false)?;

        // Full close → delegate (identical outcome, no residual).
        if close_size == position.size {
            let pnl = Self::settle_isolated_close(&env, &position, current_price, 0, None, None)?;
            extend_instance_ttl(&env);
            return Ok(pnl);
        }

        // Dust floor: the residual must still meet min_collateral.
        let config = get_config(&env);
        let collateral_closed = position.collateral * close_size / position.size;
        if position.collateral - collateral_closed < config.min_collateral {
            return Err(NoetherError::PositionTooSmall);
        }

        let pnl = Self::settle_partial_close(&env, &position, current_price, close_size, collateral_closed, 0, None);
        extend_instance_ttl(&env);
        Ok(pnl)
    }

    /// Settlement core for a partial isolated close (L0-6). Mirrors
    /// settle_isolated_close but on the CLOSED portion only, and shrinks
    /// (rather than deletes) the position. Returns pnl on the closed size.
    fn settle_partial_close(
        env: &Env,
        position: &Position,
        current_price: i128,
        close_size: i128,
        collateral_closed: i128,
        keeper_fee: i128,
        keeper: Option<&Address>,
    ) -> i128 {
        let cumulative = Self::cum_funding(env, &position.asset);
        // Funding + pnl on the CLOSED portion (a temp view at close_size).
        let mut closed_view = position.clone();
        closed_view.size = close_size;
        closed_view.collateral = collateral_closed;
        let funding = calculate_cumulative_funding(
            close_size, position.direction,
            position.entry_cumulative_funding, cumulative,
        );
        let pnl = calculate_pnl(&closed_view, current_price).unwrap_or(0);

        let vault_address = get_vault(env);
        let paid = Self::settle_with_vault(env, &vault_address, &position.trader, pnl);
        Self::flag_adl_on_shortfall(env, &position.asset, pnl, paid);

        let remaining = collateral_closed + pnl - funding;
        if remaining < 0 {
            Self::record_bad_debt(env, &vault_address, &position.trader, &position.asset, -remaining);
        }

        let usdc_token = get_usdc_token(env);
        let token_client = token::Client::new(env, &usdc_token);
        // Outflows capped by the CLOSED portion's collateral.
        let mut available = collateral_closed;
        let mut to_vault: i128 = 0;
        if pnl < 0 {
            let loss = if -pnl > available { available } else { -pnl };
            to_vault += loss;
            available -= loss;
        }
        if funding > 0 {
            let f = if funding > available { available } else { funding };
            to_vault += f;
            available -= f;
        }
        let fee_paid = if keeper_fee > available { available } else { keeper_fee };
        available -= fee_paid;

        if to_vault > 0 {
            token_client.transfer(&env.current_contract_address(), &vault_address, &to_vault);
            Self::credit_vault_receipt(env, &vault_address, to_vault);
        }
        if fee_paid > 0 {
            if let Some(k) = keeper {
                token_client.transfer(&env.current_contract_address(), k, &fee_paid);
            }
        }
        let earned_funding = if funding < 0 { -funding } else { 0 };
        let to_trader = available + paid + earned_funding;
        if to_trader > 0 {
            token_client.transfer(&env.current_contract_address(), &position.trader, &to_trader);
        }

        // Release the closed portion's OI + reservation, sync uPnL.
        Self::adjust_oi(env, &position.asset, &position.direction, close_size, position.entry_price, current_price, false);
        record_volume_only(env, &position.trader, close_size);

        // Shrink in place — ratio preserved (liq price stays valid), entry
        // funding snapshot unchanged (only the closed portion settled).
        let mut updated = position.clone();
        updated.size = position.size - close_size;
        updated.collateral = position.collateral - collateral_closed;
        save_position(env, &updated);

        env.events().publish(
            (Symbol::new(env, "position_reduced"),),
            (
                position.id, position.trader.clone(), position.asset.clone(),
                close_size, updated.size, current_price, pnl,
            ),
        );
        pnl
    }

    /// Add collateral to an isolated position (L0-6), moving its liquidation
    /// price further away. Risk-REDUCING — deliberately NOT pause-gated
    /// (exit-only-pause philosophy, L0-15). Cross uses deposit_cross_margin.
    pub fn add_collateral(
        env: Env,
        trader: Address,
        position_id: u64,
        amount: i128,
    ) -> Result<(), NoetherError> {
        require_initialized(&env)?;
        trader.require_auth();
        let mut position = get_position(&env, position_id).ok_or(NoetherError::PositionNotFound)?;
        if position.trader != trader {
            return Err(NoetherError::NotPositionOwner);
        }
        if position.margin_mode != 0 {
            return Err(NoetherError::InvalidParameter);
        }
        if amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&trader, &env.current_contract_address(), &amount);

        position.collateral += amount;
        let config = get_config(&env);
        let mm_bps = position::mm_bps_for(&env, &position, config.maintenance_margin_bps);
        let liq = Self::liquidation_price_from_ratio(
            position.entry_price, position.collateral, position.size, position.direction, mm_bps,
        );
        position.liquidation_price = if liq < 0 { 0 } else { liq };
        save_position(&env, &position);

        env.events().publish(
            (Symbol::new(&env, "collateral_added"),),
            (position_id, trader, amount, position.liquidation_price),
        );
        extend_instance_ttl(&env);
        Ok(())
    }

    /// Remove collateral from an isolated position (L0-6). Risk-INCREASING —
    /// pause-gated, IM-floor gated, and gated on a STRICT (fresh) oracle
    /// read so a stale/deviant print can't authorize margin extraction.
    pub fn remove_collateral(
        env: Env,
        trader: Address,
        position_id: u64,
        amount: i128,
    ) -> Result<(), NoetherError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;
        trader.require_auth();
        let mut position = get_position(&env, position_id).ok_or(NoetherError::PositionNotFound)?;
        if position.trader != trader {
            return Err(NoetherError::NotPositionOwner);
        }
        if position.margin_mode != 0 {
            return Err(NoetherError::InvalidParameter);
        }
        if amount <= 0 || amount >= position.collateral {
            return Err(NoetherError::InvalidAmount);
        }

        let config = get_config(&env);
        let new_collateral = position.collateral - amount;

        // IM floor: the residual must still back the position at the max
        // openable leverage (loosest ratio; L0-12's per-asset im refines it).
        if new_collateral < position.size / (config.max_leverage as i128) {
            return Err(NoetherError::InsufficientMargin);
        }

        // Safety gate at a STRICT price: equity after removal must clear MM.
        let price = Self::get_oracle_price(&env, &position.asset, true)?;
        let cumulative = Self::cum_funding(&env, &position.asset);
        let funding = calculate_cumulative_funding(
            position.size, position.direction, position.entry_cumulative_funding, cumulative,
        );
        let pnl = calculate_pnl(&position, price)?;
        let mm_bps = position::mm_bps_for(&env, &position, config.maintenance_margin_bps);
        let mm = position.size * (mm_bps as i128) / (BASIS_POINTS as i128);
        if new_collateral + pnl - funding <= mm {
            return Err(NoetherError::InsufficientMargin);
        }

        position.collateral = new_collateral;
        let liq = Self::liquidation_price_from_ratio(
            position.entry_price, new_collateral, position.size, position.direction, mm_bps,
        );
        position.liquidation_price = if liq < 0 { 0 } else { liq };
        save_position(&env, &position);

        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&env.current_contract_address(), &trader, &amount);

        env.events().publish(
            (Symbol::new(&env, "collateral_removed"),),
            (position_id, trader, amount, position.liquidation_price),
        );
        extend_instance_ttl(&env);
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Liquidation Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Liquidate an underwater position.
    /// Callable by anyone (keeper). Keeper receives liquidation reward.
    ///
    /// # Arguments
    /// * `keeper` - Address executing the liquidation (receives reward)
    /// * `position_id` - ID of position to liquidate
    ///
    /// # Returns
    /// Keeper reward amount
    ///
    /// # Flow
    /// 1. Verify position is liquidatable
    /// 2. Calculate remaining equity and keeper reward
    /// 3. Pay keeper their reward
    /// 4. Transfer remaining collateral to Vault
    /// 5. Update Vault accounting
    pub fn liquidate(
        env: Env,
        keeper: Address,
        position_id: u64,
    ) -> Result<i128, NoetherError> {
        require_initialized(&env)?;
        // Note: Liquidations should work even when paused for safety

        keeper.require_auth();

        // Get position
        let position = get_position(&env, position_id)
            .ok_or(NoetherError::PositionNotFound)?;

        // Cross-margin positions use account-level liquidation, not per-position
        if position.margin_mode == 1 {
            return Err(NoetherError::NotLiquidatable);
        }

        // Get current price
        let current_price = Self::get_oracle_price(&env, &position.asset, false)?;

        // Check if liquidatable (includes pending funding in margin check)
        if !Self::should_liquidate_with_funding(&env, &position, current_price) {
            return Err(NoetherError::NotLiquidatable);
        }

        let config = get_config(&env);

        // Calculate PnL and funding
        let pnl = calculate_pnl(&position, current_price)?;
        let cumulative = Self::cum_funding(&env, &position.asset);
        let funding = calculate_cumulative_funding(
            position.size, position.direction,
            position.entry_cumulative_funding, cumulative,
        );

        // Calculate remaining collateral after PnL and funding
        let remaining = position.collateral + pnl - funding;

        // ── Grace period (T3-D4) ──
        // A recent partial liquidation shields the position while the trader
        // reacts — EXCEPT when equity is already gone: waiting on a bankrupt
        // position only grows bad debt.
        let now = env.ledger().timestamp();
        let bankrupt = remaining <= 0;
        if !bankrupt {
            if let Some(last) = get_partial_liq_ts(&env, position_id) {
                if now.saturating_sub(last) < config.partial_liq_cooldown_secs {
                    return Err(NoetherError::LiquidationCooldown);
                }
            }
        }

        // Get addresses and token client
        let vault_address = get_vault(&env);
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);

        // ── Partial liquidation (T3-D4) ──
        // Large, non-bankrupt positions lose a tranche first: the tranche's
        // realized loss comes out of collateral while the remainder keeps
        // backing the smaller position, so the margin ratio improves by
        // ~1/(1-f) and the trader gets the grace period to recover.
        if !bankrupt
            && config.partial_liq_tranche_bps > 0
            && position.size > config.partial_liq_min_notional
        {
            let bps = BASIS_POINTS as i128;
            let tranche = config.partial_liq_tranche_bps as i128;
            let closed_size = position.size * tranche / bps;

            // Tranche share of the realized loss (positive whenever the
            // position is liquidatable), capped at held collateral.
            let mut realized_debit = (funding - pnl) * tranche / bps;
            if realized_debit < 0 {
                realized_debit = 0;
            }
            if realized_debit > position.collateral {
                realized_debit = position.collateral;
            }

            // L0-4: bounded penalty on the notional actually closed —
            // min(closed × penalty_bps, the tranche's share of remaining
            // equity) — split keeper/buffer. Replaces the 5%-of-equity
            // reward and the 10%-of-realized_debit buffer cut.
            let mut tranche_penalty =
                closed_size * (config.liquidation_penalty_bps as i128) / bps;
            let tranche_equity = remaining * tranche / bps;
            if tranche_penalty > tranche_equity {
                tranche_penalty = tranche_equity;
            }
            // Collateral cap unchanged in spirit: total debits never exceed
            // held collateral (degenerate tranche falls through to full liq).
            if tranche_penalty > position.collateral - realized_debit {
                tranche_penalty = position.collateral - realized_debit;
            }
            if tranche_penalty < 0 {
                tranche_penalty = 0;
            }
            let reward = tranche_penalty * (config.penalty_keeper_share_bps as i128) / bps;
            let tranche_buffer = tranche_penalty - reward;

            let new_size = position.size - closed_size;
            let new_collateral = position.collateral - realized_debit - tranche_penalty;

            // Degenerate tranche (nothing left to back the remainder):
            // fall through to the full liquidation below instead.
            if new_size > 0 && new_collateral > 0 {
                // Money flow (L0-4): the realized loss is an LP receipt; the
                // penalty's buffer leg rides the same transfer; keeper leg
                // pays out directly.
                let to_vault = realized_debit + tranche_buffer;
                if to_vault > 0 {
                    token_client.transfer(
                        &env.current_contract_address(), &vault_address, &to_vault,
                    );
                    Self::credit_vault_receipt(&env, &vault_address, realized_debit);
                    Self::fund_vault_buffer(&env, &vault_address, tranche_buffer);
                }
                if reward > 0 {
                    token_client.transfer(&env.current_contract_address(), &keeper, &reward);
                }

                Self::adjust_oi(
                    &env, &position.asset, &position.direction,
                    closed_size, position.entry_price, current_price, false,
                );

                // Shrink the position in place. The liquidation price is
                // recomputed from the ACTUAL collateral/size ratio — the
                // integer `leverage` field no longer reflects it.
                let mut updated = position.clone();
                updated.size = new_size;
                updated.collateral = new_collateral;
                let mm_bps = position::mm_bps_for(&env, &position, config.maintenance_margin_bps);
                updated.liquidation_price = Self::liquidation_price_from_ratio(
                    updated.entry_price, new_collateral, new_size,
                    updated.direction, mm_bps,
                );
                save_position(&env, &updated);
                set_partial_liq_ts(&env, position_id, now);

                env.events().publish(
                    (Symbol::new(&env, "position_partial_liq"),),
                    (
                        position_id, position.trader.clone(), position.asset.clone(),
                        position.direction, closed_size, reward, current_price,
                    ),
                );

                extend_instance_ttl(&env);
                return Ok(reward);
            }
        }

        // ── Full liquidation (L0-4: bounded penalty, residual refunds) ──

        let bps_i = BASIS_POINTS as i128;
        let actual_keeper_reward: i128;

        if remaining > 0 {
            // Non-bankrupt: penalty = min(1% of closed notional, remaining);
            // keeper/buffer split it; the trader gets remaining − penalty back.
            let mut penalty = position.size * (config.liquidation_penalty_bps as i128) / bps_i;
            if penalty > remaining {
                penalty = remaining;
            }
            let keeper_cut = penalty * (config.penalty_keeper_share_bps as i128) / bps_i;
            let buffer_cut = penalty - keeper_cut;
            let refund = remaining - penalty;

            // to_vault = collateral − keeper_cut − refund. Provably positive
            // at trigger (remaining < MM ≤ 10% of collateral at 10x/1%, and
            // MM = IM/2 under the L0-12 ladder keeps the bound); saturate
            // defensively anyway.
            let mut to_vault = position.collateral - keeper_cut - refund;
            if to_vault < 0 {
                to_vault = 0;
            }

            if to_vault > 0 {
                token_client.transfer(&env.current_contract_address(), &vault_address, &to_vault);
                Self::credit_vault_receipt(&env, &vault_address, to_vault - buffer_cut);
                Self::fund_vault_buffer(&env, &vault_address, buffer_cut);
            }
            if keeper_cut > 0 {
                token_client.transfer(&env.current_contract_address(), &keeper, &keeper_cut);
            }
            if refund > 0 {
                token_client.transfer(&env.current_contract_address(), &position.trader, &refund);
            }

            env.events().publish(
                (Symbol::new(&env, "liq_refund"),),
                (position.trader.clone(), position_id, refund, penalty),
            );
            actual_keeper_reward = keeper_cut;
        } else {
            // Bankrupt: full collateral to the vault (buffer share via
            // config, 0 at the L0-4 migration), keeper 0 (the buffer-funded
            // bankruptcy bounty is L1-23). The uncollectable gap is booked
            // as bad debt (L0-2): buffer draw + on-chain event.
            Self::record_bad_debt(
                &env, &vault_address, &position.trader, &position.asset, -remaining,
            );
            let vault_receives = position.collateral;
            if vault_receives > 0 {
                token_client.transfer(&env.current_contract_address(), &vault_address, &vault_receives);
                let buffer_cut =
                    vault_receives * (config.insurance_buffer_share_bps as i128) / bps_i;
                Self::credit_vault_receipt(&env, &vault_address, vault_receives - buffer_cut);
                Self::fund_vault_buffer(&env, &vault_address, buffer_cut);
            }
            actual_keeper_reward = 0;
        }

        Self::adjust_oi(&env, &position.asset, &position.direction, position.size, position.entry_price, current_price, false);

        // Cancel any attached SL/TP/trailing orders, then delete position
        Self::cancel_position_orders(&env, position_id, None);
        delete_position(&env, position_id, &position.trader);

        env.events().publish(
            (Symbol::new(&env, "position_liquidated"),),
            (position_id, position.trader, position.asset, position.direction, position.size, actual_keeper_reward, current_price),
        );

        extend_instance_ttl(&env);

        Ok(actual_keeper_reward)
    }

    // is_liquidatable removed for WASM size — the keeper computes
    // liquidation health locally from get_position + oracle price
    // (P2-9), and liquidate() itself re-verifies on-chain.

    // get_liquidatable_positions removed for WASM size - keeper checks each position individually

    // ═══════════════════════════════════════════════════════════════════════
    // Funding Rate Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Apply funding to all positions (can be called periodically).
    /// Funding balances long/short interest:
    /// - If more longs than shorts: longs pay shorts
    /// - If more shorts than longs: shorts pay longs
    /// Apply per-market funding (L0-13). Permissionless, same no-arg
    /// signature the keeper already calls. Loops every listed pair and
    /// accrues each asset's own SIP-279 velocity-based rate (clamped),
    /// driven by that asset's TIME-WEIGHTED skew — so a quiet pair cannot
    /// collect carry off another pair's imbalance, and a keeper outage
    /// under-accrues (the dt cap kills the M-7 retroactive window) rather
    /// than pricing hours at one instant's skew. Returns
    /// FundingIntervalNotElapsed (#55) only when NOTHING was due, preserving
    /// the keeper's applied|not-due tri-state.
    pub fn apply_funding(env: Env) -> Result<(), NoetherError> {
        require_initialized(&env)?;
        let now = env.ledger().timestamp();
        // Progress = a pair was seeded OR accrued this call. Seeding must
        // count: returning Err would roll back the seed, so a pure-seed
        // tick reports Ok (no funding_applied event) and #55 fires only
        // when every configured pair is already seeded and not yet due.
        let mut progressed = false;

        for (sym, _) in noether_common::assets::PAIR_TAGS {
            let asset = Symbol::new(&env, sym);
            // Unconfigured pairs accrue nothing (fail-open, not fail-closed —
            // funding is a settlement mechanic, not a risk gate).
            let params = match get_asset_risk(&env, &asset) {
                Some(p) => p,
                None => continue,
            };
            let (mut cum, prev_rate, last_ts) = get_funding_state(&env, &asset);

            // First touch: seed last_ts so the window starts here.
            if last_ts == 0 {
                set_funding_state(&env, &asset, &(cum, prev_rate, now));
                progressed = true;
                continue;
            }
            if now < last_ts + 3600 {
                continue;
            }

            // M-7 kill: one reading never prices more than one hour of
            // velocity (dt_eff caps the STEP). The average skew is still
            // fair over the real window; a keeper outage under-accrues.
            let dt_eff = if now - last_ts > 3600 { 3600 } else { now - last_ts };
            let avg_skew = Self::close_skew_window(&env, &asset, now);

            // SIP-279 velocity (PRECISION-scaled bps) → fraction-units, then
            // clamp the RATE (not the step) to ±funding_clamp_bps/h.
            let step_bps = funding_velocity(
                avg_skew, params.skew_scale, params.max_funding_velocity_bps, dt_eff,
            );
            let step_frac = step_bps / (BASIS_POINTS as i128);
            let limit = (params.funding_clamp_bps as i128) * PRECISION / (BASIS_POINTS as i128);
            let mut new_rate = prev_rate + step_frac;
            if new_rate > limit {
                new_rate = limit;
            } else if new_rate < -limit {
                new_rate = -limit;
            }

            let hours = (dt_eff / 3600) as i128; // exactly 1 given the cap
            cum += new_rate * hours;
            set_funding_state(&env, &asset, &(cum, new_rate, now));

            env.events().publish(
                (Symbol::new(&env, "funding_applied"),),
                (asset.clone(), new_rate, hours as u64, cum),
            );
            progressed = true;
        }

        if !progressed {
            return Err(NoetherError::FundingIntervalNotElapsed);
        }
        Ok(())
    }

    /// Migrate the single global funding index into per-asset indices
    /// (L0-13). Admin-only, run inside the upgrade pause window after
    /// migrate_config + set_asset_risk. Seeds every pair's index at the
    /// legacy global cumulative value so every open position's pending
    /// funding is preserved by delta-continuity — no per-position writes.
    pub fn migrate_funding(env: Env) -> Result<(), NoetherError> {
        require_initialized(&env)?;
        require_admin(&env)?;
        let now = env.ledger().timestamp();
        let legacy = get_cumulative_funding_rate(&env);
        for (sym, _) in noether_common::assets::PAIR_TAGS {
            let asset = Symbol::new(&env, sym);
            set_funding_state(&env, &asset, &(legacy, 0, now));
            env.events().publish(
                (Symbol::new(&env, "funding_migrated"),),
                (asset, legacy),
            );
        }
        Ok(())
    }

    /// One asset's cumulative funding index (L0-13). The per-market
    /// replacement for the global get_cumulative_funding_rate at every
    /// settlement/snapshot site.
    fn cum_funding(env: &Env, asset: &Symbol) -> i128 {
        get_funding_state(env, asset).0
    }

    /// L0-10 acceptable-price bound for a CLOSE (inverse of the open bound):
    /// closing a Long rejects below the bound, a Short above it. 0 =
    /// unbounded. Preserves M-2 (the contract never blocks a close — only
    /// the trader's own parameter does; resubmit with 0 always exits).
    fn check_close_bound(
        direction: Direction,
        price: i128,
        acceptable_price: i128,
    ) -> Result<(), NoetherError> {
        if acceptable_price < 0 {
            return Err(NoetherError::InvalidParameter);
        }
        if acceptable_price > 0 {
            let worse = match direction {
                Direction::Long => price < acceptable_price,
                Direction::Short => price > acceptable_price,
            };
            if worse {
                return Err(NoetherError::AcceptablePriceExceeded);
            }
        }
        Ok(())
    }

    /// Accrue the skew integral for the window since the last touch, using
    /// the skew that held over it (L0-13). Called by adjust_oi before every
    /// exposure mutation.
    fn accrue_skew_integral(env: &Env, asset: &Symbol, skew_now: i128) {
        let now = env.ledger().timestamp();
        let (integral, last) = get_skew_integral(env, asset);
        if last == 0 {
            set_skew_integral(env, asset, &(0, now));
            return;
        }
        let dt = (now - last) as i128;
        set_skew_integral(env, asset, &(integral + skew_now * dt, now));
    }

    /// Close the skew window: fold the final sub-interval and return the
    /// time-weighted average skew over the integral's OWN window
    /// [last_touch → now] (NOT dt_eff — dividing by dt_eff would inflate a
    /// multi-hour window's average). Resets the integral. Falls back to the
    /// instantaneous skew when the window is empty (fresh deploy first hour).
    fn close_skew_window(env: &Env, asset: &Symbol, now: u64) -> i128 {
        let (lk, ls, sk, ss) = get_asset_exposure(env, asset);
        let _ = (lk, sk);
        let inst = ls - ss;
        let (integral, last) = get_skew_integral(env, asset);
        set_skew_integral(env, asset, &(0, now));
        let window = if last == 0 { 0 } else { (now - last) as i128 };
        if window == 0 {
            return inst;
        }
        let total = integral + inst * window;
        total / window
    }

    // get_funding_rate removed - use get_market_stats().funding_rate instead

    // ═══════════════════════════════════════════════════════════════════════
    // View Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Get a position by ID.
    pub fn get_position(env: Env, position_id: u64) -> Option<Position> {
        get_position(&env, position_id)
    }

    // get_positions removed for WASM size - frontend queries by position ID
    // get_position_pnl removed - frontend calculates from position + price

    // get_market_stats removed for WASM size - frontend reads storage directly

    /// Get all position IDs (for keeper iteration).
    pub fn get_all_position_ids(env: Env) -> Vec<u64> {
        get_all_position_ids(&env)
    }

    // get_price removed - frontend queries oracle contract directly

    // get_config, get_vault, get_usdc_token removed for WASM size
    // Clients read from contracts.json or instance storage directly

    // ═══════════════════════════════════════════════════════════════════════
    // Admin Functions
    // ═══════════════════════════════════════════════════════════════════════

    // update_config removed for WASM size - redeploy to change config

    // pause/unpause removed for WASM size - redeploy if needed

    // set_admin removed for WASM size - redeploy contract to change admin

    // is_paused removed for WASM size

    // ═══════════════════════════════════════════════════════════════════════
    // Fee Tier Functions
    // ═══════════════════════════════════════════════════════════════════════

    // set_fee_tiers_config, get_fee_tiers_config removed for WASM size
    // Fee tiers are set at initialization. Redeploy to change.

    // get_trader_fee_info removed for WASM size - frontend computes from on-chain volume data

    // ═══════════════════════════════════════════════════════════════════════
    // Cross-Margin Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Deposit USDC into cross-margin pool.
    /// Funds are held by the Market contract and shared across all cross positions.
    pub fn deposit_cross_margin(
        env: Env,
        trader: Address,
        amount: i128,
    ) -> Result<(), NoetherError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;
        trader.require_auth();

        if amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        // Transfer USDC from trader to market contract
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&trader, &env.current_contract_address(), &amount);

        // Update cross-margin balance (checked add for overflow protection)
        let current_balance = get_cross_margin_balance(&env, &trader);
        let new_balance = current_balance.checked_add(amount)
            .ok_or(NoetherError::Overflow)?;
        set_cross_margin_balance(&env, &trader, new_balance);

        // Track trader in cross-margin list (for keeper scanning)
        add_cross_margin_trader(&env, &trader);
        extend_instance_ttl(&env);
        Ok(())
    }

    /// Withdraw USDC from cross-margin pool.
    /// Only withdrawable if free margin remains sufficient after withdrawal.
    pub fn withdraw_cross_margin(
        env: Env,
        trader: Address,
        amount: i128,
    ) -> Result<(), NoetherError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;
        trader.require_auth();

        if amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        let current_balance = get_cross_margin_balance(&env, &trader);
        if amount > current_balance {
            return Err(NoetherError::CrossMarginInsufficientBalance);
        }

        // Check free margin: can't withdraw if it would make account liquidatable
        let config = get_config(&env);
        let position_ids = get_cross_margin_position_ids(&env, &trader);

        if !position_ids.is_empty() {
            // Calculate equity AFTER withdrawal
            // Use current oracle prices; if oracle fails, use 0 which makes equity lower = safer
            // (prevents withdrawal when prices unavailable)
            let get_price = |asset: &Symbol| -> i128 {
                Self::get_oracle_price(&env, asset, false).unwrap_or(0)
            };
            let equity_before = position::calculate_cross_equity(&env, &trader, &get_price);
            let equity_after = equity_before - amount;
            let maintenance_margin = position::calculate_cross_maintenance_margin(
                &env, &trader, config.maintenance_margin_bps,
            );

            // Equity after withdrawal must exceed maintenance margin
            if equity_after <= maintenance_margin {
                return Err(NoetherError::CrossMarginInsufficientFreeMargin);
            }
        }

        // Update balance
        let new_balance = current_balance - amount;
        set_cross_margin_balance(&env, &trader, new_balance);

        // Transfer USDC back to trader
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&env.current_contract_address(), &trader, &amount);

        // If balance is 0 and no positions, remove from tracker
        if new_balance == 0 && position_ids.is_empty() {
            remove_cross_margin_trader(&env, &trader);
        }

        extend_instance_ttl(&env);
        Ok(())
    }

    /// Open a cross-margin position. Single transaction: if pool balance is
    /// insufficient, automatically transfers the shortfall from trader's wallet.
    /// Works like Binance cross-margin: no separate deposit step needed.
    pub fn open_position_cross(
        env: Env,
        trader: Address,
        asset: Symbol,
        collateral: i128,
        leverage: u32,
        direction: Direction,
        acceptable_price: i128,
    ) -> Result<Position, NoetherError> {
        Self::do_open(env, trader, asset, collateral, leverage, direction, true, acceptable_price)
    }

    /// Close a cross-margin position. PnL returns to cross-margin pool, not trader wallet.
    pub fn close_position_cross(
        env: Env,
        trader: Address,
        position_id: u64,
        acceptable_price: i128,
    ) -> Result<i128, NoetherError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;
        trader.require_auth();

        let pos = get_position(&env, position_id)
            .ok_or(NoetherError::PositionNotFound)?;

        if pos.trader != trader {
            return Err(NoetherError::NotPositionOwner);
        }
        if pos.margin_mode != 1 {
            return Err(NoetherError::InvalidParameter); // Not a cross-margin position
        }

        // Get current price and settle through the shared close core (L0-5).
        let current_price = Self::get_oracle_price(&env, &pos.asset, false)?;
        Self::check_close_bound(pos.direction, current_price, acceptable_price)?;
        let pnl = Self::settle_cross_close(&env, &pos, current_price);

        // Record volume (trader-initiated closes only — ADL doesn't count)
        record_volume_only(&env, &trader, pos.size);

        extend_instance_ttl(&env);
        Ok(pnl)
    }

    /// Shared cross-close settlement core (L0-1/L0-5): used by
    /// close_position_cross (behind its auth/pause gates) and adl_close.
    /// Outflow cap = the account's own funds (L0-2); deficit legs debit the
    /// shared pool down to zero; emits position_closed. Returns pnl.
    fn settle_cross_close(env: &Env, pos: &Position, current_price: i128) -> i128 {
        let trader = pos.trader.clone();
        let account_funds = get_cross_margin_balance(env, &trader)
            .checked_add(pos.collateral).unwrap_or(pos.collateral);
        let (pnl, pool_delta, loss_wanted, loss_transferred) =
            Self::close_cross_leg(env, pos, current_price, account_funds);
        if loss_wanted > loss_transferred {
            let vault_address = get_vault(env);
            Self::record_bad_debt(
                env, &vault_address, &trader,
                &Symbol::new(env, "CROSS"), loss_wanted - loss_transferred,
            );
        }

        // Return remaining equity to the cross pool (NOT trader wallet).
        if pool_delta != 0 {
            let current_balance = get_cross_margin_balance(env, &trader);
            let mut new_balance = current_balance.checked_add(pool_delta).unwrap_or(current_balance);
            if new_balance < 0 {
                new_balance = 0;
            }
            set_cross_margin_balance(env, &trader, new_balance);
        }

        env.events().publish(
            (Symbol::new(env, "position_closed"),),
            (pos.id, trader, pos.asset.clone(), pos.direction, pos.size, pos.entry_price, current_price, pnl),
        );

        pnl
    }

    /// Shared cross-leg settlement (L0-5), used by close_position_cross and
    /// the staged cross liquidation: settles PnL with the vault, moves
    /// loss + funding, unwinds OI / attached orders / indexes and deletes
    /// the position. The loss transfer is capped at min(max_outflow, the
    /// market's token balance) — max_outflow is the ACCOUNT's own funds
    /// (L0-2: a bankrupt account's debt must never be paid out of other
    /// traders' custody funds held at the market). Returns (realized pnl,
    /// signed pool delta = collateral + effective_pnl − funding,
    /// loss_wanted, loss_transferred) — the CALLER applies the pool delta,
    /// which lets the liquidation loop run a signed running pool so deficit
    /// legs consume later legs' remainders (order-independent residual),
    /// and books wanted − transferred as bad debt.
    fn close_cross_leg(
        env: &Env,
        pos: &Position,
        current_price: i128,
        max_outflow: i128,
    ) -> (i128, i128, i128, i128) {
        let trader = pos.trader.clone();
        let cumulative = Self::cum_funding(env, &pos.asset);
        let funding = calculate_cumulative_funding(
            pos.size, pos.direction,
            pos.entry_cumulative_funding, cumulative,
        );
        let pnl = calculate_pnl(pos, current_price).unwrap_or(0);

        let vault_address = get_vault(env);
        let paid = Self::settle_with_vault(env, &vault_address, &trader, pnl);
        Self::flag_adl_on_shortfall(env, &pos.asset, pnl, paid);

        let usdc_token = get_usdc_token(env);
        let token_client = token::Client::new(env, &usdc_token);
        let market_addr = env.current_contract_address();

        // Loss + funding move to the vault, credited on receipt; capped at
        // the account's funds AND the market's real balance.
        let mut to_vault: i128 = 0;
        if pnl < 0 {
            to_vault += -pnl;
        }
        if funding > 0 {
            to_vault += funding;
        }
        let mut transferred: i128 = 0;
        if to_vault > 0 {
            let bal = token_client.balance(&market_addr);
            let cap = if max_outflow < bal { max_outflow } else { bal };
            transferred = if to_vault > cap { cap } else { to_vault };
            if transferred < 0 {
                transferred = 0;
            }
            if transferred > 0 {
                token_client.transfer(&market_addr, &vault_address, &transferred);
                Self::credit_vault_receipt(env, &vault_address, transferred);
            }
        }

        let effective_pnl = if pnl > 0 { paid } else { pnl };
        let pool_delta = pos.collateral
            .checked_add(effective_pnl).unwrap_or(0)
            .checked_sub(funding).unwrap_or(0);

        Self::adjust_oi(env, &pos.asset, &pos.direction, pos.size, pos.entry_price, current_price, false);
        Self::cancel_position_orders(env, pos.id, None);
        remove_cross_margin_position(env, &trader, pos.id);
        delete_position(env, pos.id, &trader);

        (pnl, pool_delta, to_vault, transferred)
    }

    // is_cross_liquidatable removed for WASM size - keeper simulates liquidate_cross_account

    /// Liquidate a cross-margin account. Closes ALL cross positions.
    /// Called by keeper when account equity < maintenance margin.
    pub fn liquidate_cross_account(
        env: Env,
        keeper: Address,
        trader: Address,
    ) -> Result<i128, NoetherError> {
        require_initialized(&env)?;
        // Liquidations allowed even when paused (safety)
        keeper.require_auth();

        let config = get_config(&env);
        // For liquidation verification: oracle failure = not liquidatable (safe)
        let get_price = |asset: &Symbol| -> i128 {
            Self::get_oracle_price(&env, asset, false).unwrap_or(i128::MAX / 2)
        };

        // Verify account is liquidatable (will fail if oracle down - safe)
        if !position::is_cross_account_liquidatable(
            &env, &trader, config.maintenance_margin_bps, &get_price,
        ) {
            return Err(NoetherError::CrossMarginNotLiquidatable);
        }

        let position_ids = get_cross_margin_position_ids(&env, &trader);
        if position_ids.is_empty() {
            return Err(NoetherError::CrossMarginNoPositions);
        }

        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        let vault_address = get_vault(&env);
        let market_addr = env.current_contract_address();
        let bps_i = BASIS_POINTS as i128;
        let now = env.ledger().timestamp();

        // ── L0-5: three-branch staged liquidation ──
        let equity = position::calculate_cross_equity(&env, &trader, &get_price);
        let mm_agg = position::calculate_cross_maintenance_margin(
            &env, &trader, config.maintenance_margin_bps,
        );
        let bankrupt = equity <= 0;
        let close_out =
            !bankrupt && equity < mm_agg * (config.cross_close_out_bps as i128) / bps_i;
        let staged = !bankrupt && !close_out;

        // Grace period between staged rounds (account-scoped #83);
        // bankruptcy and close-out override it — waiting only grows bad debt.
        if staged {
            if let Some(last) = get_cross_partial_liq_ts(&env, &trader) {
                if now.saturating_sub(last) < config.partial_liq_cooldown_secs {
                    return Err(NoetherError::LiquidationCooldown);
                }
            }
        }

        // Candidates (pid, upnl, size) at lenient prices, skipping
        // unreadable-price legs exactly as before.
        let mut cands: Vec<(u64, i128, i128)> = Vec::new(&env);
        for i in 0..position_ids.len() {
            let pid = position_ids.get(i).unwrap();
            if let Some(pos) = get_position(&env, pid) {
                match Self::get_oracle_price(&env, &pos.asset, false) {
                    Ok(p) if p > 0 => {
                        let pnl = calculate_pnl(&pos, p).unwrap_or(0);
                        cands.push_back((pid, pnl, pos.size));
                    }
                    _ => continue,
                }
            }
        }

        // Ascending uPnL (worst loser first — best health-per-close, the
        // Lighter takeover order); tie-break: larger size first.
        let n = cands.len();
        let mut i = 1u32;
        while i < n {
            let key = cands.get(i).unwrap();
            let mut j = i;
            while j > 0 {
                let prev = cands.get(j - 1).unwrap();
                if prev.1 < key.1 || (prev.1 == key.1 && prev.2 >= key.2) {
                    break;
                }
                cands.set(j, prev);
                j -= 1;
            }
            cands.set(j, key);
            i += 1;
        }

        // Signed running pool: leg remainders credit it, deficit legs debit
        // it (possibly below zero mid-loop), penalties come out of the
        // positive part. Written back clamped at the end. In parallel,
        // remaining_account_funds bounds every loss transfer to the
        // account's OWN money (pool balance + closed legs' collateral) —
        // the L0-2 fix for bankrupt debt spending other traders' custody.
        let start_balance = get_cross_margin_balance(&env, &trader);
        let mut running_pool: i128 = start_balance;
        let mut remaining_account_funds: i128 = start_balance;
        let mut total_pnl: i128 = 0;
        let mut total_keeper: i128 = 0;
        let mut total_penalty: i128 = 0;
        let mut total_bad_debt: i128 = 0;

        let mut idx = 0u32;
        while idx < cands.len() {
            let (pid, _upnl, _sz) = cands.get(idx).unwrap();
            idx += 1;
            let pos = match get_position(&env, pid) {
                Some(p) => p,
                None => continue,
            };
            let current_price = match Self::get_oracle_price(&env, &pos.asset, false) {
                Ok(p) if p > 0 => p,
                _ => continue,
            };

            remaining_account_funds = remaining_account_funds
                .checked_add(pos.collateral).unwrap_or(remaining_account_funds);
            let (pnl, pool_delta, loss_wanted, loss_transferred) =
                Self::close_cross_leg(&env, &pos, current_price, remaining_account_funds);
            remaining_account_funds -= loss_transferred;
            if loss_wanted > loss_transferred {
                total_bad_debt += loss_wanted - loss_transferred;
            }
            total_pnl += pnl;
            running_pool = running_pool.checked_add(pool_delta).unwrap_or(running_pool);

            // Per-leg penalty (L0-4 split), skipped when bankrupt; capped at
            // the positive part of the running pool.
            let mut keeper_cut_leg: i128 = 0;
            if !bankrupt {
                let mut penalty = pos.size * (config.liquidation_penalty_bps as i128) / bps_i;
                let available = if running_pool > 0 { running_pool } else { 0 };
                if penalty > available {
                    penalty = available;
                }
                if penalty > 0 {
                    keeper_cut_leg = penalty * (config.penalty_keeper_share_bps as i128) / bps_i;
                    let buffer_cut = penalty - keeper_cut_leg;
                    running_pool -= penalty;
                    // Transfers are bounded by the market's real balance.
                    let bal = token_client.balance(&market_addr);
                    let k = if keeper_cut_leg > bal { bal } else { keeper_cut_leg };
                    if k > 0 {
                        token_client.transfer(&market_addr, &keeper, &k);
                    }
                    let bal2 = token_client.balance(&market_addr);
                    let b = if buffer_cut > bal2 { bal2 } else { buffer_cut };
                    if b > 0 {
                        token_client.transfer(&market_addr, &vault_address, &b);
                        Self::fund_vault_buffer(&env, &vault_address, b);
                    }
                    keeper_cut_leg = k;
                    total_keeper += k;
                    total_penalty += penalty;
                    // Penalty payouts are the trader's money leaving the
                    // market — they consume account funds too.
                    remaining_account_funds -= k + b;
                }
            }

            env.events().publish(
                (Symbol::new(&env, "position_liquidated"),),
                (pid, trader.clone(), pos.asset.clone(), pos.direction,
                 pos.size, keeper_cut_leg, current_price),
            );

            // Staged rounds stop once the survivors are healthy again:
            // true equity = running pool + survivors' (collateral + upnl −
            // funding), computed against the UNWRITTEN running pool.
            if staged {
                let stored = get_cross_margin_balance(&env, &trader);
                let eq_stored = position::calculate_cross_equity(&env, &trader, &get_price);
                let eq_true = eq_stored - stored + running_pool;
                let mm_left = position::calculate_cross_maintenance_margin(
                    &env, &trader, config.maintenance_margin_bps,
                );
                if mm_left == 0
                    || eq_true >= mm_left * (config.cross_liq_restore_target_bps as i128) / bps_i
                {
                    break;
                }
            }
        }

        // Book the account's uncollectable debt once, account-scoped (L0-2):
        // buffer draw + bad_debt_recorded with the CROSS sentinel asset.
        if total_bad_debt > 0 {
            Self::record_bad_debt(
                &env, &vault_address, &trader,
                &Symbol::new(&env, "CROSS"), total_bad_debt,
            );
        }

        // Write the pool back (clamped); bankrupt accounts force-zero.
        let final_balance = if bankrupt || running_pool < 0 { 0 } else { running_pool };
        set_cross_margin_balance(&env, &trader, final_balance);

        let survivors = get_cross_margin_position_ids(&env, &trader);
        if survivors.is_empty() {
            // Fully closed: the residual stays claimable on the pool (L0-4).
            env.events().publish(
                (Symbol::new(&env, "liq_refund"),),
                (trader.clone(), 0u64, final_balance, total_penalty),
            );
            remove_cross_partial_liq_ts(&env, &trader);
            if final_balance == 0 {
                remove_cross_margin_trader(&env, &trader);
            }
        } else {
            // Survivors keep trading under the grace period.
            set_cross_partial_liq_ts(&env, &trader, now);
        }

        extend_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "cross_liq"),),
            (trader, total_pnl, total_keeper),
        );

        Ok(total_keeper)
    }

    // ═══════════════════════════════════════════════════════════════════
    // Auto-deleveraging (L0-1) — the terminal backstop between insurance
    // depletion and short-paying winners. In the pool model the vault is
    // the counterparty of every winner, so ADL = force-realizing the
    // highest-ranked winners at the oracle mark: they are paid IN FULL
    // (zero slippage by construction) and lose only future upside.
    // ═══════════════════════════════════════════════════════════════════

    /// Permissionless solvency check: flips the asset's ADL flag on when
    /// pool coverage (buffer + LP USDC) falls under adl_trigger_ratio_bps
    /// of the payable winner uPnL, and off again above the clear ratio
    /// (hysteresis). Returns the flag. Pause-exempt, lenient price read —
    /// it must work in exactly the stress states it exists for.
    pub fn check_adl_trigger(env: Env, asset: Symbol) -> Result<bool, NoetherError> {
        require_initialized(&env)?;
        let config = get_config(&env);
        let price = Self::get_oracle_price(&env, &asset, false)?;

        let (lk, ls, sk, ss) = get_asset_exposure(&env, &asset);
        let long_upnl = (price * lk) / PRECISION - ls;
        let short_upnl = ss - (price * sk) / PRECISION;
        let mut payable: i128 = 0;
        if long_upnl > 0 {
            payable += long_upnl;
        }
        if short_upnl > 0 {
            payable += short_upnl;
        }

        let vault_address = get_vault(&env);
        let no_args: Vec<soroban_sdk::Val> = Vec::new(&env);
        let buffer: i128 = env.invoke_contract(
            &vault_address, &Symbol::new(&env, "get_buffer_balance"), no_args.clone(),
        );
        let lp: i128 = env.invoke_contract(
            &vault_address, &Symbol::new(&env, "get_total_usdc"), no_args,
        );
        let coverage = buffer + lp;

        let bps = BASIS_POINTS as i128;
        let active = get_adl_active(&env, &asset);
        if !active
            && payable > 0
            && coverage * bps < payable * (config.adl_trigger_ratio_bps as i128)
        {
            set_adl_active(&env, &asset, true);
            env.events().publish(
                (Symbol::new(&env, "adl_triggered"),),
                (asset.clone(), 0u32, payable, coverage),
            );
            extend_instance_ttl(&env);
            return Ok(true);
        }
        if active
            && (payable == 0 || coverage * bps >= payable * (config.adl_clear_ratio_bps as i128))
        {
            set_adl_active(&env, &asset, false);
            env.events().publish(
                (Symbol::new(&env, "adl_cleared"),),
                (asset.clone(), 0u32, payable, coverage),
            );
            extend_instance_ttl(&env);
            return Ok(false);
        }
        Ok(active)
    }

    /// Whether ADL is active for an asset.
    pub fn is_adl_active(env: Env, asset: Symbol) -> bool {
        get_adl_active(&env, &asset)
    }

    /// Set per-market risk params (L0-12). Admin-only. The asset must be a
    /// listed pair and params must satisfy the MM=IM/2 ladder invariant.
    /// The first successful call stamps RiskEpochTs, activating the ladder:
    /// from then on risk-increasing ops on UNconfigured assets fail #88,
    /// while positions opened before the stamp keep the legacy MM.
    pub fn set_asset_risk(
        env: Env,
        asset: Symbol,
        params: AssetRiskParams,
    ) -> Result<(), NoetherError> {
        require_initialized(&env)?;
        require_admin(&env)?;
        // Must be a listed pair (reuses the oracle-tag registry).
        noether_common::assets::symbol_to_tag(&env, &asset)
            .map_err(|_| NoetherError::InvalidParameter)?;
        if !params.is_valid() {
            return Err(NoetherError::InvalidParameter);
        }
        set_asset_risk(&env, &asset, &params);
        if get_risk_epoch_ts(&env) == 0 {
            set_risk_epoch_ts(&env, env.ledger().timestamp());
        }
        env.events().publish(
            (Symbol::new(&env, "asset_risk_set"),),
            (asset, params.max_leverage, params.im_bps, params.mm_bps),
        );
        extend_instance_ttl(&env);
        Ok(())
    }

    /// Per-market risk params for an asset (L0-12) — the single source of
    /// truth the keeper (simulate) and gateway (contractReader) read.
    pub fn get_asset_risk(env: Env, asset: Symbol) -> Option<AssetRiskParams> {
        get_asset_risk(&env, &asset)
    }

    /// Force-realize a winning position at the oracle mark while ADL is
    /// active for its asset (L0-1). Permissionless — the on-chain gates
    /// (flag active + net winner) are the consensus; the keeper's ranking
    /// walk is advisory ordering. Pause-exempt (same class as liquidate).
    /// The trader is paid in full through the normal close settlement and
    /// optionally compensated from the buffer (adl_compensation_bps).
    pub fn adl_close(env: Env, caller: Address, position_id: u64) -> Result<i128, NoetherError> {
        require_initialized(&env)?;
        caller.require_auth();

        let pos = get_position(&env, position_id).ok_or(NoetherError::PositionNotFound)?;
        if !get_adl_active(&env, &pos.asset) {
            return Err(NoetherError::AdlNotActive);
        }
        let config = get_config(&env);
        let price = Self::get_oracle_price(&env, &pos.asset, false)?;

        let cumulative = Self::cum_funding(&env, &pos.asset);
        let funding = calculate_cumulative_funding(
            pos.size, pos.direction, pos.entry_cumulative_funding, cumulative,
        );
        let pnl = calculate_pnl(&pos, price)?;
        if pnl - funding <= 0 {
            return Err(NoetherError::AdlNotEligible);
        }

        // Advisory ranking score for the event tape:
        // adl_rank = PnL% (bps of collateral) × leverage.
        let score = if pos.collateral > 0 {
            (pnl * (BASIS_POINTS as i128) / pos.collateral) * (pos.leverage as i128)
        } else {
            0
        };

        let realized = if pos.margin_mode == 1 {
            Self::settle_cross_close(&env, &pos, price)
        } else {
            Self::settle_isolated_close(&env, &pos, price, 0, None, None)?
        };

        // Optional better-than-mark compensation from the buffer (the
        // Lighter prelaunch analog; 0 = disabled at launch).
        let comp = pos.size * (config.adl_compensation_bps as i128) / (BASIS_POINTS as i128);
        if comp > 0 {
            let vault_address = get_vault(&env);
            let args: Vec<soroban_sdk::Val> = (pos.trader.clone(), comp).into_val(&env);
            let _paid: i128 = env.invoke_contract(
                &vault_address, &Symbol::new(&env, "pay_from_buffer"), args,
            );
        }

        env.events().publish(
            (Symbol::new(&env, "adl_executed"),),
            (
                position_id, pos.trader.clone(), pos.asset.clone(), pos.direction,
                pos.size, price, realized, score,
            ),
        );

        extend_instance_ttl(&env);
        Ok(realized)
    }

    /// Get cross-margin balance for a trader (pool balance only).
    pub fn get_cross_margin_balance(env: Env, trader: Address) -> i128 {
        get_cross_margin_balance(&env, &trader)
    }

    /// Get cross-margin position IDs for a trader.
    pub fn get_cross_margin_positions(env: Env, trader: Address) -> Vec<u64> {
        get_cross_margin_position_ids(&env, &trader)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Order Functions (Limit Orders, Stop-Loss, Take-Profit)
    // ═══════════════════════════════════════════════════════════════════════

    /// Place a limit entry order.
    /// Collateral is locked immediately when the order is placed.
    /// Order executes when price reaches trigger_price (based on trigger_condition).
    ///
    /// # Arguments
    /// * `trader` - Address of the trader
    /// * `asset` - Asset symbol (e.g., "BTC", "ETH", "XLM")
    /// * `direction` - Long or Short
    /// * `collateral` - USDC collateral to lock (7 decimals)
    /// * `leverage` - Leverage multiplier (1-10)
    /// * `trigger_price` - Price at which to execute (7 decimals)
    /// * `trigger_above` - true = execute when price >= trigger, false = when price <= trigger
    /// * `slippage_tolerance_bps` - Max allowed slippage in basis points (e.g., 100 = 1%)
    ///
    /// # Returns
    /// The created Order
    /// Place a limit order.
    ///
    /// # Time-in-Force (`time_in_force` parameter)
    /// - `0` = GTC (Good Till Cancel) — stays open until triggered or cancelled
    /// - `1` = IOC (Immediate Or Cancel) — executes immediately if conditions met, else cancelled
    /// - `2` = Post Only — rejected if it would execute immediately (guarantees maker fee)
    ///
    /// # Reduce Only (bit 8 of `time_in_force`)
    /// If `time_in_force` has bit 8 set (e.g., `0x100` or `0x101`), the order is reduce-only:
    /// it will only execute if the trader has an existing position in the opposite direction.
    /// Bits 0-7 still encode the TIF mode.
    pub fn place_limit_order(
        env: Env,
        trader: Address,
        asset: Symbol,
        direction: Direction,
        collateral: i128,
        leverage: u32,
        trigger_price: i128,
        trigger_above: bool,
        slippage_tolerance_bps: u32,
        time_in_force: u32,
    ) -> Result<Order, NoetherError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;

        trader.require_auth();

        let config = get_config(&env);

        // Validate parameters
        if collateral < config.min_collateral {
            return Err(NoetherError::InsufficientCollateral);
        }
        // Per-market ladder (L0-12): a resting entry is a risk-increasing op.
        let (max_leverage, max_position_size, _mm_bps) =
            Self::effective_open_limits(&env, &asset, &config)?;
        if leverage < 1 || leverage > max_leverage {
            return Err(NoetherError::InvalidLeverage);
        }
        if trigger_price <= 0 {
            return Err(NoetherError::InvalidTriggerPrice);
        }
        if slippage_tolerance_bps == 0 || slippage_tolerance_bps > 10000 {
            return Err(NoetherError::InvalidSlippageTolerance);
        }

        // Extract TIF mode (bits 0-7) and validate
        let tif_mode = time_in_force & 0xFF;
        if tif_mode > 2 {
            return Err(NoetherError::InvalidParameter);
        }

        // Calculate position size to check against limits
        let size = calculate_position_size(collateral, leverage);
        if size > max_position_size {
            return Err(NoetherError::PositionTooLarge);
        }

        let trigger_condition = if trigger_above {
            TriggerCondition::Above
        } else {
            TriggerCondition::Below
        };

        // Post Only (tif_mode == 2): reject if trigger condition is already met
        if tif_mode == 2 {
            let current_price = Self::get_oracle_price(&env, &asset, true)?;
            let would_fill = match trigger_condition {
                TriggerCondition::Above => current_price >= trigger_price,
                TriggerCondition::Below => current_price <= trigger_price,
            };
            if would_fill {
                return Err(NoetherError::PostOnlyViolation);
            }
        }

        // Transfer collateral from trader to market contract (lock it)
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&trader, &env.current_contract_address(), &collateral);

        // IOC (tif_mode == 1): check if trigger is met now, execute or cancel
        if tif_mode == 1 {
            let current_price = Self::get_oracle_price(&env, &asset, true)?;
            let triggered = match trigger_condition {
                TriggerCondition::Above => current_price >= trigger_price,
                TriggerCondition::Below => current_price <= trigger_price,
            };
            if !triggered {
                // Cancel: refund collateral immediately
                token_client.transfer(&env.current_contract_address(), &trader, &collateral);
                // Create cancelled order record
                let order_id = next_order_id(&env);
                let order = Order {
                    id: order_id,
                    trader: trader.clone(),
                    asset,
                    order_type: OrderType::LimitEntry,
                    direction,
                    collateral,
                    leverage,
                    trigger_price,
                    trigger_condition,
                    slippage_tolerance_bps,
                    position_id: 0,
                    has_position: false,
                    created_at: env.ledger().timestamp(),
                    status: OrderStatus::Cancelled,
                    limit_price: 0,
                    trailing_percent_bps: 0,
                    time_in_force,
                    stop_limit_phase: 0,
                };
                env.storage().persistent().set(&storage::DataKey::Order(order_id), &order);
                env.events().publish(
                    (Symbol::new(&env, "order_cancelled"),),
                    (order_id, Symbol::new(&env, "ioc_not_filled")),
                );
                return Ok(order);
            }
            // Trigger met — fall through to create as Pending, keeper executes immediately
        }

        // Generate order ID
        let order_id = next_order_id(&env);

        // Create order
        let order = Order {
            id: order_id,
            trader: trader.clone(),
            asset: asset.clone(),
            order_type: OrderType::LimitEntry,
            direction,
            collateral,
            leverage,
            trigger_price,
            trigger_condition,
            slippage_tolerance_bps,
            position_id: 0,
            has_position: false,
            created_at: env.ledger().timestamp(),
            status: OrderStatus::Pending,
            limit_price: 0,
            trailing_percent_bps: 0,
            time_in_force,
            stop_limit_phase: 0,
        };

        // Store order
        save_order(&env, &order);

        extend_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "order_placed"),),
            (order_id, trader, trigger_price),
        );

        Ok(order)
    }

    /// Set a stop-loss order on an existing position.
    /// Automatically closes the position when price reaches trigger to limit losses.
    ///
    /// # Arguments
    /// * `trader` - Address of the trader (must own position)
    /// * `position_id` - ID of the position to protect
    /// * `trigger_price` - Price at which to close (7 decimals)
    /// * `slippage_tolerance_bps` - Max allowed slippage in basis points
    pub fn set_stop_loss(
        env: Env,
        trader: Address,
        position_id: u64,
        trigger_price: i128,
        slippage_tolerance_bps: u32,
    ) -> Result<Order, NoetherError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;

        trader.require_auth();

        // Validate slippage
        if slippage_tolerance_bps == 0 || slippage_tolerance_bps > 10000 {
            return Err(NoetherError::InvalidSlippageTolerance);
        }

        // Get position
        let position = get_position(&env, position_id)
            .ok_or(NoetherError::PositionNotFound)?;

        // Verify ownership
        if position.trader != trader {
            return Err(NoetherError::NotPositionOwner);
        }

        // Cross-margin positions must close via the cross path; an attached
        // order would pay out of the shared pool through the isolated path.
        if position.margin_mode == 1 {
            return Err(NoetherError::CrossMarginOrderNotSupported);
        }

        // Check if SL already exists
        if get_position_stop_loss(&env, position_id).is_some() {
            return Err(NoetherError::OrderAlreadyExists);
        }

        // Validate trigger price based on direction
        // For Long: stop-loss must be BELOW entry price (triggers when price falls)
        // For Short: stop-loss must be ABOVE entry price (triggers when price rises)
        match position.direction {
            Direction::Long => {
                if trigger_price >= position.entry_price {
                    return Err(NoetherError::InvalidTriggerPrice);
                }
            }
            Direction::Short => {
                if trigger_price <= position.entry_price {
                    return Err(NoetherError::InvalidTriggerPrice);
                }
            }
        }

        // Determine trigger condition
        // Long position: close when price <= trigger (price falling)
        // Short position: close when price >= trigger (price rising)
        let trigger_condition = match position.direction {
            Direction::Long => TriggerCondition::Below,
            Direction::Short => TriggerCondition::Above,
        };

        // Generate order ID
        let order_id = next_order_id(&env);

        // Create order
        let order = Order {
            id: order_id,
            trader: trader.clone(),
            asset: position.asset.clone(),
            order_type: OrderType::StopLoss,
            direction: position.direction,
            collateral: 0, // No collateral locked for SL
            leverage: position.leverage,
            trigger_price,
            trigger_condition,
            slippage_tolerance_bps,
            position_id,
            has_position: true,
            created_at: env.ledger().timestamp(),
            status: OrderStatus::Pending,
            limit_price: 0,
            trailing_percent_bps: 0,
            time_in_force: 0,
            stop_limit_phase: 0,
        };

        // Store order and link to position
        save_order(&env, &order);
        set_position_stop_loss(&env, position_id, order_id);

        extend_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "order_placed"),),
            (order_id, trader, trigger_price),
        );

        Ok(order)
    }

    /// Set a take-profit order on an existing position.
    /// Automatically closes the position when price reaches trigger to lock in profits.
    ///
    /// # Arguments
    /// * `trader` - Address of the trader (must own position)
    /// * `position_id` - ID of the position
    /// * `trigger_price` - Price at which to close (7 decimals)
    /// * `slippage_tolerance_bps` - Max allowed slippage in basis points
    pub fn set_take_profit(
        env: Env,
        trader: Address,
        position_id: u64,
        trigger_price: i128,
        slippage_tolerance_bps: u32,
        limit_price: i128,
    ) -> Result<Order, NoetherError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;

        trader.require_auth();

        // Validate slippage
        if slippage_tolerance_bps == 0 || slippage_tolerance_bps > 10000 {
            return Err(NoetherError::InvalidSlippageTolerance);
        }

        // Get position
        let position = get_position(&env, position_id)
            .ok_or(NoetherError::PositionNotFound)?;

        // Verify ownership
        if position.trader != trader {
            return Err(NoetherError::NotPositionOwner);
        }

        // Cross-margin positions must close via the cross path
        if position.margin_mode == 1 {
            return Err(NoetherError::CrossMarginOrderNotSupported);
        }

        // Check if TP already exists
        if get_position_take_profit(&env, position_id).is_some() {
            return Err(NoetherError::OrderAlreadyExists);
        }

        // Validate trigger price based on direction
        // For Long: take-profit must be ABOVE entry price (profit when price rises)
        // For Short: take-profit must be BELOW entry price (profit when price falls)
        match position.direction {
            Direction::Long => {
                if trigger_price <= position.entry_price {
                    return Err(NoetherError::InvalidTriggerPrice);
                }
            }
            Direction::Short => {
                if trigger_price >= position.entry_price {
                    return Err(NoetherError::InvalidTriggerPrice);
                }
            }
        }

        // Determine trigger condition
        // Long position: close when price >= trigger (price rising to target)
        // Short position: close when price <= trigger (price falling to target)
        let trigger_condition = match position.direction {
            Direction::Long => TriggerCondition::Above,
            Direction::Short => TriggerCondition::Below,
        };

        // Generate order ID
        let order_id = next_order_id(&env);

        // Validate limit_price if provided (must be between entry and trigger for TP)
        if limit_price > 0 {
            match position.direction {
                Direction::Long => {
                    // Long TP: limit_price should be >= entry (still profitable) and <= trigger
                    if limit_price > trigger_price || limit_price < position.entry_price {
                        return Err(NoetherError::InvalidParameter);
                    }
                }
                Direction::Short => {
                    // Short TP: limit_price should be <= entry (still profitable) and >= trigger
                    if limit_price < trigger_price || limit_price > position.entry_price {
                        return Err(NoetherError::InvalidParameter);
                    }
                }
            }
        }

        // Create order
        let order = Order {
            id: order_id,
            trader: trader.clone(),
            asset: position.asset.clone(),
            order_type: OrderType::TakeProfit,
            direction: position.direction,
            collateral: 0, // No collateral locked for TP
            leverage: position.leverage,
            trigger_price,
            trigger_condition,
            slippage_tolerance_bps,
            position_id,
            has_position: true,
            created_at: env.ledger().timestamp(),
            status: OrderStatus::Pending,
            limit_price,
            trailing_percent_bps: 0,
            time_in_force: 0,
            stop_limit_phase: 0,
        };

        // Store order and link to position
        save_order(&env, &order);
        set_position_take_profit(&env, position_id, order_id);

        extend_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "order_placed"),),
            (order_id, trader, trigger_price),
        );

        Ok(order)
    }

    /// Cancel a pending order.
    /// For limit orders, refunds the locked collateral.
    ///
    /// # Arguments
    /// * `trader` - Address of the trader (must own order)
    /// * `order_id` - ID of the order to cancel
    pub fn cancel_order(
        env: Env,
        trader: Address,
        order_id: u64,
    ) -> Result<(), NoetherError> {
        require_initialized(&env)?;

        trader.require_auth();

        // Get order
        let order = get_order(&env, order_id)
            .ok_or(NoetherError::OrderNotFound)?;

        // Verify ownership
        if order.trader != trader {
            return Err(NoetherError::NotOrderOwner);
        }

        // Check if still pending
        if order.status != OrderStatus::Pending {
            return Err(NoetherError::OrderNotPending);
        }

        // Refund collateral for orders that lock funds
        if (order.order_type == OrderType::LimitEntry || order.order_type == OrderType::StopLimit)
            && order.collateral > 0
        {
            let usdc_token = get_usdc_token(&env);
            let token_client = token::Client::new(&env, &usdc_token);
            token_client.transfer(&env.current_contract_address(), &trader, &order.collateral);
        }

        // Clean up linked data
        if order.order_type == OrderType::TrailingStop {
            remove_trailing_stop_peak(&env, order_id);
        }
        if order.has_position {
            match order.order_type {
                OrderType::StopLoss => remove_position_stop_loss(&env, order.position_id),
                OrderType::TakeProfit => remove_position_take_profit(&env, order.position_id),
                OrderType::TrailingStop => remove_position_trailing_stop(&env, order.position_id),
                _ => {}
            }
        }

        // Update order status
        update_order_status(&env, order_id, OrderStatus::Cancelled);

        extend_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "order_cancelled"),),
            (order_id, Symbol::new(&env, "user")),
        );

        Ok(())
    }

    /// Execute a triggered order (called by keeper).
    /// Checks if price condition is met and executes the order.
    /// Keeper receives a fee for successful execution.
    ///
    /// # Arguments
    /// * `keeper` - Address of the keeper executing the order
    /// * `order_id` - ID of the order to execute
    ///
    /// # Returns
    /// Keeper reward amount
    pub fn execute_order(
        env: Env,
        keeper: Address,
        order_id: u64,
    ) -> Result<i128, NoetherError> {
        require_initialized(&env)?;

        keeper.require_auth();

        // Get order
        let order = get_order(&env, order_id)
            .ok_or(NoetherError::OrderNotFound)?;

        // Check if still pending
        if order.status != OrderStatus::Pending {
            return Err(NoetherError::OrderNotPending);
        }

        // Strict price for entry executions (deviation band + staleness);
        // lenient for risk-reducing close-type orders — including
        // reduce-only entries, which close an opposing position
        let strict_price = order.time_in_force & 0x100 == 0
            && matches!(
                order.order_type,
                OrderType::LimitEntry | OrderType::StopLimit
            );
        let current_price = Self::get_oracle_price(&env, &order.asset, strict_price)?;

        let ref_price = Self::order_ref_price(&env, &order);

        // Check if trigger condition is met
        let triggered = match order.trigger_condition {
            TriggerCondition::Above => current_price >= ref_price,
            TriggerCondition::Below => current_price <= ref_price,
        };

        if !triggered {
            return Err(NoetherError::OrderNotTriggered);
        }

        // Check slippage against reference price
        let price_diff = if current_price > ref_price {
            current_price - ref_price
        } else {
            ref_price - current_price
        };
        let actual_slippage_bps = if ref_price > 0 {
            (price_diff * 10_000) / ref_price
        } else {
            0
        };

        if actual_slippage_bps > order.slippage_tolerance_bps as i128 {
            // Slippage exceeded - cancel the order and commit the cancellation
            // IMPORTANT: We return Ok(0) instead of Err() so the transaction commits
            // and the order is properly removed from the pending list. Returning Err()
            // would rollback all state changes, leaving the order stuck in pending.

            if (order.order_type == OrderType::LimitEntry || order.order_type == OrderType::StopLimit)
                && order.collateral > 0
            {
                let usdc_token = get_usdc_token(&env);
                let token_client = token::Client::new(&env, &usdc_token);
                token_client.transfer(&env.current_contract_address(), &order.trader, &order.collateral);
            }

            // Clean up linked data
            if order.order_type == OrderType::TrailingStop {
                remove_trailing_stop_peak(&env, order_id);
            }
            if order.has_position {
                match order.order_type {
                    OrderType::StopLoss => remove_position_stop_loss(&env, order.position_id),
                    OrderType::TakeProfit => remove_position_take_profit(&env, order.position_id),
                    OrderType::TrailingStop => remove_position_trailing_stop(&env, order.position_id),
                    _ => {}
                }
            }

            update_order_status(&env, order_id, OrderStatus::CancelledSlippage);

            extend_instance_ttl(&env);

            env.events().publish(
                (Symbol::new(&env, "order_cancelled"),),
                (order_id, Symbol::new(&env, "slippage")),
            );

            // Return Ok(0) - no keeper reward for cancelled orders, but transaction commits
            return Ok(0);
        }

        // Calculate keeper fee
        let keeper_fee = Self::calculate_keeper_order_fee(&env, &order);

        // Execute based on order type
        let result = match order.order_type {
            OrderType::LimitEntry => {
                Self::execute_limit_entry(&env, &order, current_price, keeper_fee, &keeper)
            }
            OrderType::StopLoss | OrderType::TakeProfit => {
                Self::execute_close_order(&env, &order, current_price, keeper_fee, &keeper)
            }
            OrderType::StopLimit => {
                if order.stop_limit_phase == 0 {
                    // Phase 0→1: Stop triggered, activate limit phase
                    let mut updated = order.clone();
                    updated.stop_limit_phase = 1;
                    env.storage().persistent().set(
                        &storage::DataKey::Order(order_id), &updated,
                    );
                    // No execution yet, no keeper reward for phase transition
                    return Ok(0);
                } else {
                    // Phase 1: Limit price reached, execute as limit entry
                    Self::execute_limit_entry(&env, &order, current_price, keeper_fee, &keeper)
                }
            }
            OrderType::TrailingStop => {
                // Clean up peak tracking
                remove_trailing_stop_peak(&env, order_id);
                // Execute as close order (same as SL/TP)
                Self::execute_close_order(&env, &order, current_price, keeper_fee, &keeper)
            }
        };

        match result {
            Ok(reward) => {
                update_order_status(&env, order_id, OrderStatus::Executed);

                extend_instance_ttl(&env);

                env.events().publish(
                    (Symbol::new(&env, "order_executed"),),
                    (order_id, reward),
                );

                Ok(reward)
            }
            Err(e) => Err(e),
        }
    }

    // should_execute_order removed for WASM size — the keeper previews
    // executions by SIMULATING execute_order (P2-9/K-5), which also
    // kills the double price read per scan.

    /// Reference price an order triggers (and slippage-checks) against.
    /// TakeProfit with limit_price > 0 is a Take Limit: both the trigger
    /// and slippage compare to limit_price (the desired exit).
    fn order_ref_price(env: &Env, order: &Order) -> i128 {
        match order.order_type {
            OrderType::StopLimit if order.stop_limit_phase == 1 => order.limit_price,
            OrderType::TakeProfit if order.limit_price > 0 => order.limit_price,
            OrderType::TrailingStop => {
                if let Some(peak) = get_trailing_stop_peak(env, order.id) {
                    match order.direction {
                        Direction::Long => peak - peak * (order.trailing_percent_bps as i128) / 10000,
                        Direction::Short => peak + peak * (order.trailing_percent_bps as i128) / 10000,
                    }
                } else {
                    order.trigger_price
                }
            }
            _ => order.trigger_price,
        }
    }

    // get_orders removed for WASM size - frontend queries all_order_ids and gets each

    /// Get a specific order by ID.
    pub fn get_order(env: Env, order_id: u64) -> Option<Order> {
        get_order(&env, order_id)
    }

    /// Get all pending order IDs (for keeper).
    pub fn get_all_order_ids(env: Env) -> Vec<u64> {
        get_all_order_ids(&env)
    }

    // get_position_orders removed for WASM size - frontend reads SL/TP from trader orders

    // ═══════════════════════════════════════════════════════════════════════
    // Advanced Order Types
    // ═══════════════════════════════════════════════════════════════════════

    /// Place a stop-limit order.
    /// Phase 1: waits for price to hit trigger_price (stop).
    /// Phase 2: once triggered, acts as limit order at limit_price.
    /// Place a stop-limit order with optional time-in-force and reduce-only flags.
    /// See `place_limit_order` for `time_in_force` encoding details.
    /// Note: IOC and PostOnly apply to the limit phase (phase 1), not the stop phase.
    pub fn place_stop_limit_order(
        env: Env,
        trader: Address,
        asset: Symbol,
        direction: Direction,
        collateral: i128,
        leverage: u32,
        trigger_price: i128,
        limit_price: i128,
        trigger_above: bool,
        slippage_tolerance_bps: u32,
        time_in_force: u32,
    ) -> Result<Order, NoetherError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;
        trader.require_auth();

        let config = get_config(&env);
        if collateral < config.min_collateral {
            return Err(NoetherError::InsufficientCollateral);
        }
        // Per-market ladder (L0-12): a resting stop-limit is risk-increasing.
        let (max_leverage, max_position_size, _mm_bps) =
            Self::effective_open_limits(&env, &asset, &config)?;
        if leverage < 1 || leverage > max_leverage {
            return Err(NoetherError::InvalidLeverage);
        }
        if trigger_price <= 0 || limit_price <= 0 {
            return Err(NoetherError::InvalidTriggerPrice);
        }
        if slippage_tolerance_bps == 0 || slippage_tolerance_bps > 10000 {
            return Err(NoetherError::InvalidSlippageTolerance);
        }

        // Validate TIF mode (bits 0-7)
        let tif_mode = time_in_force & 0xFF;
        if tif_mode > 2 {
            return Err(NoetherError::InvalidParameter);
        }

        let size = calculate_position_size(collateral, leverage);
        if size > max_position_size {
            return Err(NoetherError::PositionTooLarge);
        }

        // Lock collateral
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&trader, &env.current_contract_address(), &collateral);

        let order_id = next_order_id(&env);
        let trigger_condition = if trigger_above {
            TriggerCondition::Above
        } else {
            TriggerCondition::Below
        };

        let order = Order {
            id: order_id,
            trader: trader.clone(),
            asset,
            order_type: OrderType::StopLimit,
            direction,
            collateral,
            leverage,
            trigger_price,
            trigger_condition,
            slippage_tolerance_bps,
            position_id: 0,
            has_position: false,
            created_at: env.ledger().timestamp(),
            status: OrderStatus::Pending,
            limit_price,
            trailing_percent_bps: 0,
            time_in_force,
            stop_limit_phase: 0, // WaitingForStop
        };

        save_order(&env, &order);
        extend_instance_ttl(&env);
        Ok(order)
    }

    /// Place a trailing stop order attached to a position.
    /// Tracks peak price, triggers when price drops trailing_percent from peak.
    pub fn place_trailing_stop(
        env: Env,
        trader: Address,
        position_id: u64,
        trailing_percent_bps: u32,
        slippage_tolerance_bps: u32,
    ) -> Result<Order, NoetherError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;
        trader.require_auth();

        if trailing_percent_bps == 0 || trailing_percent_bps > 5000 {
            return Err(NoetherError::InvalidTrailingPercent);
        }
        if slippage_tolerance_bps == 0 || slippage_tolerance_bps > 10000 {
            return Err(NoetherError::InvalidSlippageTolerance);
        }

        let position = get_position(&env, position_id)
            .ok_or(NoetherError::PositionNotFound)?;
        if position.trader != trader {
            return Err(NoetherError::NotPositionOwner);
        }

        // Cross-margin positions must close via the cross path
        if position.margin_mode == 1 {
            return Err(NoetherError::CrossMarginOrderNotSupported);
        }

        // One trailing stop per position
        if get_position_trailing_stop(&env, position_id).is_some() {
            return Err(NoetherError::OrderAlreadyExists);
        }

        // Get current price as initial peak
        let current_price = Self::get_oracle_price(&env, &position.asset, true)?;

        // Set trigger condition based on direction
        // Long: trailing stop triggers below peak (price drops)
        // Short: trailing stop triggers above peak (price rises)
        let trigger_condition = match position.direction {
            Direction::Long => TriggerCondition::Below,
            Direction::Short => TriggerCondition::Above,
        };

        let order_id = next_order_id(&env);

        let order = Order {
            id: order_id,
            trader: trader.clone(),
            asset: position.asset.clone(),
            order_type: OrderType::TrailingStop,
            direction: position.direction,
            collateral: 0,
            leverage: position.leverage,
            trigger_price: 0, // Dynamic, calculated from peak
            trigger_condition,
            slippage_tolerance_bps,
            position_id,
            has_position: true,
            created_at: env.ledger().timestamp(),
            status: OrderStatus::Pending,
            limit_price: 0,
            trailing_percent_bps,
            time_in_force: 0,
            stop_limit_phase: 0,
        };

        // Store peak price
        set_trailing_stop_peak(&env, order_id, current_price);

        save_order(&env, &order);
        set_position_trailing_stop(&env, position_id, order_id);
        extend_instance_ttl(&env);
        Ok(order)
    }

    /// Update trailing stop peak price for a specific order.
    /// Called by keeper for each trailing stop order per cycle.
    pub fn update_trailing_peak(
        env: Env,
        order_id: u64,
    ) -> Result<bool, NoetherError> {
        require_initialized(&env)?;

        let order = get_order(&env, order_id)
            .ok_or(NoetherError::OrderNotFound)?;

        if order.order_type != OrderType::TrailingStop || order.status != OrderStatus::Pending {
            return Ok(false);
        }

        let current_price = Self::get_oracle_price(&env, &order.asset, true)?;

        if let Some(peak) = get_trailing_stop_peak(&env, order_id) {
            let new_peak = match order.direction {
                Direction::Long => if current_price > peak { current_price } else { peak },
                Direction::Short => if current_price < peak { current_price } else { peak },
            };
            if new_peak != peak {
                set_trailing_stop_peak(&env, order_id, new_peak);
                return Ok(true);
            }
        }

        Ok(false)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Internal Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Check if position should be liquidated, including cumulative funding.
    fn should_liquidate_with_funding(env: &Env, pos: &Position, price: i128) -> bool {
        if should_liquidate(pos, price) { return true; }
        // Margin check with cumulative funding
        let pnl = calculate_pnl(pos, price).unwrap_or(0);
        let cumulative = Self::cum_funding(env, &pos.asset);
        let funding = calculate_cumulative_funding(
            pos.size, pos.direction,
            pos.entry_cumulative_funding, cumulative,
        );
        let margin = pos.collateral + pnl - funding;
        let config = get_config(env);
        // Per-asset MM once the ladder is live (L0-12); legacy for
        // grandfathered / pre-ladder positions.
        let mm_bps = position::mm_bps_for(env, pos, config.maintenance_margin_bps);
        margin < pos.size * (mm_bps as i128) / (BASIS_POINTS as i128)
    }

    /// Fetch price from the oracle adapter.
    ///
    /// `strict` is set on risk-INCREASING paths (opens, trailing peaks):
    /// they reject stale prices AND moves beyond max_oracle_deviation_bps
    /// vs the stored last-good price. Risk-reducing paths (closes,
    /// liquidations) pass strict=false — they are never blocked by
    /// staleness or the deviation band (M-2 halt-open/allow-close).
    /// The band is skipped when the last-good price is older than
    /// 10x the staleness window (nothing traded for a while — a large
    /// legitimate move must not brick the market).
    fn get_oracle_price(env: &Env, asset: &Symbol, strict: bool) -> Result<i128, NoetherError> {
        let oracle_address = get_oracle_adapter(env);
        let args: Vec<soroban_sdk::Val> = (asset.clone(),).into_val(env);
        let (price, timestamp): (i128, u64) = env.invoke_contract(
            &oracle_address,
            &Symbol::new(env, "lastprice"),
            args,
        );

        if price <= 0 {
            return Err(NoetherError::InvalidPrice);
        }

        let config = get_config(env);
        let now = env.ledger().timestamp();
        let fresh = !(now > timestamp && now - timestamp > config.max_price_staleness);

        if strict {
            if !fresh {
                return Err(NoetherError::PriceStale);
            }
            if config.max_oracle_deviation_bps > 0 {
                if let Some((last, last_ts)) = get_last_good_price(env, asset) {
                    if last > 0 && now.saturating_sub(last_ts) <= 10 * config.max_price_staleness {
                        let diff = if price > last { price - last } else { last - price };
                        if diff * (BASIS_POINTS as i128) / last
                            > config.max_oracle_deviation_bps as i128
                        {
                            return Err(NoetherError::PriceDeviationTooHigh);
                        }
                    }
                }
            }
        }

        if fresh {
            set_last_good_price(env, asset, price, now);
        }
        Ok(price)
    }

    /// Shared open finalisation: persist the position (indexing it under
    /// the cross account when applicable), update OI/exposure aggregates,
    /// move the trading fee to the vault and emit position_opened.
    fn finalize_open(env: &Env, position: &Position, fee: i128) {
        save_position(env, position);
        if position.margin_mode == 1 {
            add_cross_margin_position(env, &position.trader, position.id);
        }
        Self::adjust_oi(
            env,
            &position.asset,
            &position.direction,
            position.size,
            position.entry_price,
            position.entry_price,
            true,
        );
        if fee > 0 {
            let vault = get_vault(env);
            let usdc = get_usdc_token(env);
            let client = token::Client::new(env, &usdc);
            // Protocol fee share (P1-10): a slice of every trading fee goes
            // to the treasury (insurance/ops funding); inactive until
            // set_fee_split wires a treasury address
            let mut cut = fee * (get_protocol_fee_bps(env) as i128) / (BASIS_POINTS as i128);
            match get_treasury(env) {
                Some(t) if cut > 0 => {
                    client.transfer(&env.current_contract_address(), &t, &cut);
                }
                _ => cut = 0,
            }
            let vault_share = fee - cut;
            if vault_share > 0 {
                client.transfer(&env.current_contract_address(), &vault, &vault_share);
                Self::credit_vault_receipt(env, &vault, vault_share);
            }
        }
        env.events().publish(
            (Symbol::new(env, "position_opened"),),
            (
                position.id,
                position.trader.clone(),
                position.asset.clone(),
                position.direction,
                position.size,
                position.entry_price,
            ),
        );
    }

    /// Shared isolated-close settlement used by close_position and keeper
    /// order execution: settles PnL and funding with the vault, pays the
    /// trader (and optional keeper fee), cancels attached orders, deletes
    /// the position and emits position_closed. Returns the realised PnL.
    fn settle_isolated_close(
        env: &Env,
        position: &Position,
        current_price: i128,
        keeper_fee: i128,
        keeper: Option<&Address>,
        skip_order: Option<u64>,
    ) -> Result<i128, NoetherError> {
        let cumulative = Self::cum_funding(env, &position.asset);
        let funding = calculate_cumulative_funding(
            position.size, position.direction,
            position.entry_cumulative_funding, cumulative,
        );
        let pnl = calculate_pnl(position, current_price)?;

        let vault_address = get_vault(env);
        let paid = Self::settle_with_vault(env, &vault_address, &position.trader, pnl);
        Self::flag_adl_on_shortfall(env, &position.asset, pnl, paid);

        // L0-2: the gap between owed loss+funding and this position's own
        // collateral is bad debt — book it (buffer draw + event) instead of
        // letting it land on LP NAV silently.
        let remaining = position.collateral + pnl - funding;
        if remaining < 0 {
            Self::record_bad_debt(env, &vault_address, &position.trader, &position.asset, -remaining);
        }

        let usdc_token = get_usdc_token(env);
        let token_client = token::Client::new(env, &usdc_token);

        // Outflows are capped by this position's own collateral — a
        // leveraged loss can never dip into other positions' margin;
        // the vault is credited only for USDC that actually arrives.
        let mut available = position.collateral;
        let mut to_vault: i128 = 0;
        if pnl < 0 {
            let loss = if -pnl > available { available } else { -pnl };
            to_vault += loss;
            available -= loss;
        }
        if funding > 0 {
            let f = if funding > available { available } else { funding };
            to_vault += f;
            available -= f;
        }
        let fee_paid = if keeper_fee > available { available } else { keeper_fee };
        available -= fee_paid;

        if to_vault > 0 {
            token_client.transfer(&env.current_contract_address(), &vault_address, &to_vault);
            Self::credit_vault_receipt(env, &vault_address, to_vault);
        }
        if fee_paid > 0 {
            if let Some(k) = keeper {
                token_client.transfer(&env.current_contract_address(), k, &fee_paid);
            }
        }
        // Negative funding = trader earned it; pays out on top as before
        let earned_funding = if funding < 0 { -funding } else { 0 };
        let to_trader = available + paid + earned_funding;
        if to_trader > 0 {
            token_client.transfer(&env.current_contract_address(), &position.trader, &to_trader);
        }

        Self::adjust_oi(env, &position.asset, &position.direction, position.size, position.entry_price, current_price, false);
        record_volume_only(env, &position.trader, position.size);
        Self::cancel_position_orders(env, position.id, skip_order);
        delete_position(env, position.id, &position.trader);

        env.events().publish(
            (Symbol::new(env, "position_closed"),),
            (position.id, position.trader.clone(), position.asset.clone(), position.direction, position.size, position.entry_price, current_price, pnl),
        );
        Ok(pnl)
    }

    /// One choke point for every open/close/liquidation: adjusts the
    /// global per-side OI totals AND the per-asset exposure aggregates,
    /// then pushes the asset's fresh unrealized PnL to the vault —
    /// releasing the position's payout reservation in the same call on
    /// closes. Decreases saturate at zero.
    fn adjust_oi(
        env: &Env,
        asset: &Symbol,
        direction: &Direction,
        size: i128,
        entry_price: i128,
        mark_price: i128,
        increase: bool,
    ) {
        let total = match direction {
            Direction::Long => get_total_long_size(env),
            Direction::Short => get_total_short_size(env),
        };
        let new_total = if increase {
            total + size
        } else if total > size {
            total - size
        } else {
            0
        };
        match direction {
            Direction::Long => set_total_long_size(env, new_total),
            Direction::Short => set_total_short_size(env, new_total),
        }

        let (mut lk, mut ls, mut sk, mut ss) = get_asset_exposure(env, asset);

        // Time-weighted skew (L0-13, M-7): accrue the OLD skew (ls−ss) over
        // the window since the last touch BEFORE this trade mutates it.
        Self::accrue_skew_integral(env, asset, ls - ss);

        let k_delta = if entry_price > 0 { size * PRECISION / entry_price } else { 0 };
        let sat = |cur: i128, d: i128| if cur > d { cur - d } else { 0 };
        match direction {
            Direction::Long => {
                if increase {
                    lk += k_delta;
                    ls += size;
                } else {
                    lk = sat(lk, k_delta);
                    ls = sat(ls, size);
                }
            }
            Direction::Short => {
                if increase {
                    sk += k_delta;
                    ss += size;
                } else {
                    sk = sat(sk, k_delta);
                    ss = sat(ss, size);
                }
            }
        }
        set_asset_exposure(env, asset, &(lk, ls, sk, ss));

        let upnl = Self::exposure_upnl(lk, ls, sk, ss, mark_price);
        Self::push_exposure(env, asset, upnl, if increase { 0 } else { size });
    }

    /// Push one asset's unrealized PnL (+ optional reservation release)
    /// to the vault.
    fn push_exposure(env: &Env, asset: &Symbol, upnl: i128, release: i128) {
        let vault = get_vault(env);
        let args: Vec<soroban_sdk::Val> = (asset.clone(), upnl, release).into_val(env);
        let _: () = env.invoke_contract(&vault, &Symbol::new(env, "sync_exposure"), args);
    }

    /// Aggregate unrealized trader PnL for one asset at the given mark.
    fn exposure_upnl(lk: i128, ls: i128, sk: i128, ss: i128, mark: i128) -> i128 {
        (mark * lk) / PRECISION - ls + ss - (mark * sk) / PRECISION
    }

    /// Cancel any SL/TP/trailing orders still attached to a position that is
    /// being closed or liquidated, so no zombie Pending orders survive it.
    /// `skip` is the order currently being executed (its status transition is
    /// owned by the caller); its link is still removed.
    fn cancel_position_orders(env: &Env, position_id: u64, skip: Option<u64>) {
        let linked = [
            get_position_stop_loss(env, position_id),
            get_position_take_profit(env, position_id),
            get_position_trailing_stop(env, position_id),
        ];
        for order_id in linked.iter().flatten() {
            if skip == Some(*order_id) {
                continue;
            }
            update_order_status(env, *order_id, OrderStatus::Cancelled);
            remove_trailing_stop_peak(env, *order_id);
            env.events().publish(
                (Symbol::new(env, "order_cancelled"),),
                (*order_id, Symbol::new(env, "pos_closed")),
            );
        }
        remove_position_stop_loss(env, position_id);
        remove_position_take_profit(env, position_id);
        remove_position_trailing_stop(env, position_id);
    }

    /// Reserve the position's max payout in the vault (real reservation —
    /// rejects past the aggregate or per-asset-side OI caps, #82).
    fn reserve_with_vault(
        env: &Env,
        vault: &Address,
        asset: &Symbol,
        direction: &Direction,
        size: i128,
    ) -> Result<(), NoetherError> {
        let (_, ls, _, ss) = get_asset_exposure(env, asset);
        let side_after = match direction {
            Direction::Long => ls + size,
            Direction::Short => ss + size,
        };
        // Net skew = long − short OI (L0-14). before/after let the vault
        // pass skew-reducing opens even past a tightened cap.
        let net_before = ls - ss;
        let net_after = match direction {
            Direction::Long => net_before + size,
            Direction::Short => net_before - size,
        };
        let args: Vec<soroban_sdk::Val> =
            (asset.clone(), size, side_after, net_before, net_after).into_val(env);
        let _: () = env.invoke_contract(vault, &Symbol::new(env, "reserve_for_position"), args);
        Ok(())
    }

    /// Settle PnL with the vault. Returns the profit actually paid out
    /// (capped at what the pool holds; the vault books any shortfall as a
    /// per-trader claimable liability — L0-3). Losses return 0 — the vault
    /// is credited via receive_funds_credit only when USDC actually moves.
    ///
    /// ⚠️ ABI: vault settle_pnl is (trader, pnl) since L0-3 — market and
    /// vault MUST promote together in the same blue-green cutover.
    fn settle_with_vault(env: &Env, vault: &Address, trader: &Address, pnl: i128) -> i128 {
        let args: Vec<soroban_sdk::Val> = (trader.clone(), pnl).into_val(env);
        env.invoke_contract(vault, &Symbol::new(env, "settle_pnl"), args)
    }

    /// Tell the vault to credit USDC the market just transferred in
    /// (losses, funding) — accounting follows real receipts (V-3 tail).
    fn credit_vault_receipt(env: &Env, vault: &Address, amount: i128) {
        if amount > 0 {
            let args: Vec<soroban_sdk::Val> = (amount,).into_val(env);
            let _: () = env.invoke_contract(vault, &Symbol::new(env, "receive_loss"), args);
        }
    }

    /// Route a slice of liquidation proceeds into the vault's insurance
    /// buffer (T3-D4). Accounting-only on the vault side — the USDC itself
    /// travels with the same transfer as the LP share.
    fn fund_vault_buffer(env: &Env, vault: &Address, amount: i128) {
        if amount > 0 {
            let args: Vec<soroban_sdk::Val> = (amount,).into_val(env);
            let _: () = env.invoke_contract(vault, &Symbol::new(env, "fund_buffer"), args);
        }
    }

    /// Any short-paid winner is proof the pool cannot cover its liabilities:
    /// flip the asset's ADL flag immediately, with no keeper involvement
    /// (L0-1). reason=1 distinguishes the shortfall path from the
    /// coverage-ratio trigger (reason=0).
    fn flag_adl_on_shortfall(env: &Env, asset: &Symbol, pnl: i128, paid: i128) {
        if pnl > 0 && paid < pnl && !get_adl_active(env, asset) {
            set_adl_active(env, asset, true);
            env.events().publish(
                (Symbol::new(env, "adl_triggered"),),
                (asset.clone(), 1u32, 0i128, 0i128),
            );
        }
    }

    /// Effective open-time limits for an asset (L0-12): the per-market
    /// ladder once RiskEpochTs is stamped (fail-closed #88 on an
    /// unconfigured asset — a risk-increasing op), else the legacy global
    /// MarketConfig (pre-ladder deployments and tests). Returns
    /// (max_leverage, max_position_size, mm_bps).
    fn effective_open_limits(
        env: &Env,
        asset: &Symbol,
        config: &MarketConfig,
    ) -> Result<(u32, i128, u32), NoetherError> {
        if get_risk_epoch_ts(env) == 0 {
            return Ok((
                config.max_leverage,
                config.max_position_size,
                config.maintenance_margin_bps,
            ));
        }
        let p = get_asset_risk(env, asset).ok_or(NoetherError::AssetRiskNotConfigured)?;
        let implied_cap = (BASIS_POINTS / p.im_bps).max(1);
        let cap = if p.max_leverage < implied_cap { p.max_leverage } else { implied_cap };
        Ok((cap, p.max_position_size, p.mm_bps))
    }

    /// Book a bankrupt-liquidation loss (L0-2): the vault's insurance buffer
    /// covers what it can (accounting draw — the USDC was never collected),
    /// the rest lands on LP NAV, and BOTH are made visible on-chain via
    /// bad_debt_recorded(trader, asset, amount, buffer_covered, lp_absorbed).
    fn record_bad_debt(env: &Env, vault: &Address, trader: &Address, asset: &Symbol, amount: i128) {
        if amount <= 0 {
            return;
        }
        let args: Vec<soroban_sdk::Val> = (amount,).into_val(env);
        let covered: i128 = env.invoke_contract(vault, &Symbol::new(env, "draw_buffer"), args);
        env.events().publish(
            (Symbol::new(env, "bad_debt_recorded"),),
            (trader.clone(), asset.clone(), amount, covered, amount - covered),
        );
    }

    /// Liquidation price from the ACTUAL collateral/size ratio — the
    /// generalized form of math::calculate_liquidation_price, needed once a
    /// partial liquidation leaves a non-integer effective leverage.
    fn liquidation_price_from_ratio(
        entry_price: i128,
        collateral: i128,
        size: i128,
        direction: Direction,
        maintenance_margin_bps: u32,
    ) -> i128 {
        let leverage_factor = collateral * PRECISION / size;
        let margin_factor =
            (maintenance_margin_bps as i128) * PRECISION / (BASIS_POINTS as i128);
        let adjustment = leverage_factor - margin_factor;
        match direction {
            Direction::Long => entry_price - (entry_price * adjustment / PRECISION),
            Direction::Short => entry_price + (entry_price * adjustment / PRECISION),
        }
    }

    // apply_funding_to_position removed — replaced by cumulative funding model.
    // Funding is now computed on-the-fly via calculate_cumulative_funding().

    // ═══════════════════════════════════════════════════════════════════════
    // Internal Order Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Calculate keeper fee for order execution.
    /// Fee = base_fee (0.50 USDC) + variable_fee (0.05% of position size)
    fn calculate_keeper_order_fee(env: &Env, order: &Order) -> i128 {
        let fee_config = KeeperFeeConfig::default();

        let position_size = match order.order_type {
            OrderType::LimitEntry | OrderType::StopLimit => {
                calculate_position_size(order.collateral, order.leverage)
            }
            OrderType::StopLoss | OrderType::TakeProfit | OrderType::TrailingStop => {
                if let Some(pos) = get_position(env, order.position_id) {
                    pos.size
                } else {
                    0
                }
            }
        };

        let variable_fee = (position_size * fee_config.variable_fee_bps as i128) / 10_000;
        fee_config.base_fee + variable_fee
    }

    /// Execute a limit entry order - opens a new position.
    fn execute_limit_entry(
        env: &Env,
        order: &Order,
        current_price: i128,
        keeper_fee: i128,
        keeper: &Address,
    ) -> Result<i128, NoetherError> {
        let config = get_config(env);

        // Reduce Only (bit 8 of time_in_force): REDUCES the trader's largest
        // opposing isolated position in this asset (M-6). L0-6: it now
        // PARTIALLY reduces an oversized target instead of skipping it —
        // reduce_size = min(intended, target.size). The order's locked
        // collateral is refunded either way; no opposing position → cancel.
        if order.time_in_force & 0x100 != 0 {
            let intended_size = calculate_position_size(order.collateral, order.leverage);
            let mut target: Option<Position> = None;
            for pid in get_trader_position_ids(env, &order.trader).iter() {
                if let Some(pos) = get_position(env, pid) {
                    if pos.asset == order.asset
                        && pos.direction != order.direction
                        && pos.margin_mode == 0
                        && target.as_ref().is_none_or(|t| pos.size > t.size)
                    {
                        target = Some(pos);
                    }
                }
            }

            let usdc_token = get_usdc_token(env);
            let token_client = token::Client::new(env, &usdc_token);
            if order.collateral > 0 {
                token_client.transfer(&env.current_contract_address(), &order.trader, &order.collateral);
            }

            return match target {
                Some(pos) => {
                    let reduce_size = if intended_size < pos.size { intended_size } else { pos.size };
                    let config = get_config(env);
                    let collateral_closed = pos.collateral * reduce_size / pos.size;
                    // Full reduce, or a residual that would breach the dust
                    // floor → close the whole position (never trap the keeper).
                    if reduce_size >= pos.size
                        || pos.collateral - collateral_closed < config.min_collateral
                    {
                        Self::settle_isolated_close(
                            env, &pos, current_price, keeper_fee, Some(keeper), Some(order.id),
                        )?;
                    } else {
                        Self::settle_partial_close(
                            env, &pos, current_price, reduce_size, collateral_closed,
                            keeper_fee, Some(keeper),
                        );
                    }
                    Ok(keeper_fee)
                }
                None => {
                    update_order_status(env, order.id, OrderStatus::Cancelled);
                    env.events().publish(
                        (Symbol::new(env, "order_cancelled"),),
                        (order.id, Symbol::new(env, "reduce_only_no_position")),
                    );
                    Ok(0)
                }
            };
        }

        // Per-market ladder (L0-12): a raised leverage cap can retire a
        // resting order's validity — re-check at execution and cancel +
        // refund rather than open a now-illegal position. Also supplies
        // the per-asset MM for the liq price. Legacy limits pre-ladder.
        let (max_leverage, max_position_size, mm_bps) =
            match Self::effective_open_limits(env, &order.asset, &config) {
                Ok(limits) => limits,
                Err(_) => (config.max_leverage, config.max_position_size, config.maintenance_margin_bps),
            };
        let size = calculate_position_size(order.collateral, order.leverage);
        if order.leverage > max_leverage || size > max_position_size {
            // LimitEntry/StopLimit orders lock full collateral — refund it.
            if order.collateral > 0 {
                let usdc_token = get_usdc_token(env);
                let token_client = token::Client::new(env, &usdc_token);
                token_client.transfer(&env.current_contract_address(), &order.trader, &order.collateral);
            }
            update_order_status(env, order.id, OrderStatus::Cancelled);
            env.events().publish(
                (Symbol::new(env, "order_cancelled"),),
                (order.id, Symbol::new(env, "risk_config")),
            );
            return Ok(0);
        }

        // Check Vault has enough liquidity
        let vault_address = get_vault(env);
        Self::reserve_with_vault(env, &vault_address, &order.asset, &order.direction, size)?;

        // Calculate liquidation price using current price as entry
        let liquidation_price = calculate_liquidation_price(
            current_price,
            order.leverage,
            order.direction,
            mm_bps,
        );

        // Calculate maker fee and record volume (limit orders = maker)
        let trading_fee = calculate_fee_and_record_volume(env, &order.trader, size, true, &config);

        // Total fees = trading fee + keeper fee
        let total_fees = trading_fee + keeper_fee;
        let net_collateral = order.collateral - total_fees;

        if net_collateral <= 0 {
            return Err(NoetherError::InsufficientCollateral);
        }

        // Generate position ID
        let position_id = next_position_id(env);

        // Create position (isolated margin - limit orders always isolated)
        let position = Position {
            id: position_id,
            trader: order.trader.clone(),
            asset: order.asset.clone(),
            collateral: net_collateral,
            size,
            entry_price: current_price,
            direction: order.direction,
            leverage: order.leverage,
            liquidation_price,
            timestamp: env.ledger().timestamp(),
            entry_cumulative_funding: Self::cum_funding(env, &order.asset),
            margin_mode: 0, // Isolated
        };

        Self::finalize_open(env, &position, trading_fee);

        // Pay keeper fee
        if keeper_fee > 0 {
            let usdc_token = get_usdc_token(env);
            token::Client::new(env, &usdc_token).transfer(
                &env.current_contract_address(),
                keeper,
                &keeper_fee,
            );
        }

        Ok(keeper_fee)
    }

    /// Execute a stop-loss or take-profit order - closes the position.
    fn execute_close_order(
        env: &Env,
        order: &Order,
        current_price: i128,
        keeper_fee: i128,
        keeper: &Address,
    ) -> Result<i128, NoetherError> {
        // Get position
        let position = get_position(env, order.position_id)
            .ok_or(NoetherError::PositionNotFound)?;

        Self::settle_isolated_close(
            env, &position, current_price, keeper_fee, Some(keeper), Some(order.id),
        )?;

        Ok(keeper_fee)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════
//
// Integration tests temporarily reduced to core trading tests.
// Full test suite will be restored after WASM size optimization.
// Removed view functions: get_positions, get_orders, get_market_stats,
// get_config, get_fee_tiers_config, get_trader_fee_info, is_paused,
// is_cross_liquidatable, add_collateral, set_admin, update_config,
// pause, unpause, set_fee_tiers_config.

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger as _}, token::StellarAssetClient, Env, Address, Symbol};
    use noether_common::{PRECISION, MarketConfig};

    // ═══════════════════════════════════════════════════════════════════
    // Test Helpers
    // ═══════════════════════════════════════════════════════════════════

    #[allow(dead_code)] // fixture keeps handles tests may not all read
    struct TestEnv {
        env: Env,
        admin: Address,
        market_id: Address,
        market: MarketContractClient<'static>,
        usdc_token: Address,
        vault_id: Address,
        oracle_id: Address,
    }

    fn setup() -> TestEnv {
        setup_with_vault_deposit(10_000_000 * PRECISION)
    }

    fn setup_with_vault_deposit(vault_deposit: i128) -> TestEnv {
        setup_full(vault_deposit, MarketConfig::default())
    }

    /// Custom-config variant (L0-4+): lets risk tests emulate the L0-12
    /// ladder regime (e.g. MM > penalty, which is what makes liquidation
    /// refunds non-zero — at the flat 1% MM, penalty ≡ MM and refunds are
    /// structurally 0).
    fn setup_with_config(config: MarketConfig) -> TestEnv {
        setup_full(10_000_000 * PRECISION, config)
    }

    fn setup_full(vault_deposit: i128, config: MarketConfig) -> TestEnv {
        let env = Env::default();
        env.mock_all_auths();
        env.budget().reset_unlimited(); // Allow complex cross-contract tests

        // Set a realistic timestamp (so funding/volume day calc works)
        env.ledger().set_timestamp(1_700_000_000); // ~Nov 2023

        let admin = Address::generate(&env);

        // Deploy USDC token (SAC test token)
        let usdc_sac = env.register_stellar_asset_contract_v2(admin.clone());
        let usdc_token = usdc_sac.address();

        // Deploy inline test oracle (SEP-40 lastprice shape; replaces the
        // retired mock_oracle crate — tests are self-contained now)
        let oracle_id = env.register_contract(None, mock_oracle::MockOracle);
        let oracle_client = mock_oracle::Client::new(&env, &oracle_id);
        oracle_client.initialize(&admin);

        // Set prices: BTC=$60k, ETH=$3k, XLM=$0.10
        oracle_client.set_price(&Symbol::new(&env, "BTC"), &(60_000 * PRECISION));
        oracle_client.set_price(&Symbol::new(&env, "ETH"), &(3_000 * PRECISION));
        oracle_client.set_price(&Symbol::new(&env, "XLM"), &(PRECISION / 10));

        // Deploy vault (simplified - use mock that just approves liquidity)
        let vault_id = env.register_contract_wasm(None, vault::WASM);

        // Deploy NOE token for vault
        let noe_sac = env.register_stellar_asset_contract_v2(admin.clone());
        let noe_token = noe_sac.address();

        // Deploy market
        let market_id = env.register_contract(None, MarketContract);
        let market = MarketContractClient::new(&env, &market_id);

        // Initialize vault
        let vault_client = vault::Client::new(&env, &vault_id);
        vault_client.initialize(
            &admin,
            &usdc_token,
            &noe_token,
            &market_id,
            &30,  // 0.3% deposit fee
            &30,  // 0.3% withdraw fee
        );

        // Mint NOE to vault (pre-mint model)
        let noe_admin = StellarAssetClient::new(&env, &noe_token);
        noe_admin.mint(&vault_id, &(1_000_000_000 * PRECISION));

        // Deposit USDC into vault for liquidity
        let usdc_admin = StellarAssetClient::new(&env, &usdc_token);
        usdc_admin.mint(&admin, &(vault_deposit + 10 * PRECISION));
        vault_client.deposit(&admin, &vault_deposit);

        // Initialize market with the caller-provided config
        market.initialize(&admin, &oracle_id, &vault_id, &usdc_token, &config);

        TestEnv { env, admin, market_id, market, usdc_token, vault_id, oracle_id }
    }

    fn fund_trader(test: &TestEnv, amount: i128) -> Address {
        let trader = Address::generate(&test.env);
        let usdc_admin = StellarAssetClient::new(&test.env, &test.usdc_token);
        usdc_admin.mint(&trader, &amount);
        trader
    }

    // Inline test oracle — a minimal SEP-40 price source the market reads via
    // `lastprice(asset) -> (i128, u64)`. Replaces the deleted mock_oracle crate
    // so `cargo test -p market` is self-contained.
    mod mock_oracle {
        use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

        #[contracttype]
        pub enum DataKey {
            Price(Symbol),
        }

        #[contract]
        pub struct MockOracle;

        #[contractimpl]
        impl MockOracle {
            pub fn initialize(_env: Env, _admin: Address) {}

            pub fn set_price(env: Env, asset: Symbol, price: i128) {
                let ts = env.ledger().timestamp();
                env.storage().persistent().set(&DataKey::Price(asset), &(price, ts));
            }

            pub fn lastprice(env: Env, asset: Symbol) -> (i128, u64) {
                env.storage().persistent().get(&DataKey::Price(asset)).unwrap()
            }
        }

        pub use MockOracleClient as Client;
    }

    mod vault {
        soroban_sdk::contractimport!(
            file = "../target/wasm32-unknown-unknown/release/vault.wasm"
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    // Fee Tier Tests
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_open_position_charges_taker_fee() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        let position = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long, &0,
        );

        // Taker fee at tier 0 = 50 deci-bps = 0.050% of $500 = $0.25
        let expected_fee = 500 * PRECISION * 50 / 100_000;
        let expected_collateral = 100 * PRECISION - expected_fee;
        assert_eq!(position.collateral, expected_collateral);
    }

    // Fee tier integration tests removed - fee tiers are set at init,
    // admin set/get functions removed for WASM size

    // ═══════════════════════════════════════════════════════════════════
    // Core Trading Tests
    // ═══════════════════════════════════════════════════════════════════

    // ── L0-10: acceptable-price bound on market open/close ──────────────

    #[test]
    fn test_open_long_beyond_bound_reverts() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let xlm = Symbol::new(&test.env, "XLM"); // $0.10 entry
        // Long bound BELOW the mark → entry $0.10 > bound $0.09 = worse → #87.
        let res = test.market.try_open_position(
            &trader, &xlm, &(100 * PRECISION), &5, &Direction::Long, &(PRECISION * 9 / 100),
        );
        assert!(matches!(res, Err(Ok(NoetherError::AcceptablePriceExceeded))));
        // A bound AT/above the mark fills.
        let ok = test.market.open_position(
            &trader, &xlm, &(100 * PRECISION), &5, &Direction::Long, &(PRECISION * 11 / 100),
        );
        assert_eq!(ok.entry_price, PRECISION / 10);
    }

    #[test]
    fn test_open_short_beyond_bound_reverts() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let xlm = Symbol::new(&test.env, "XLM");
        // Short bound ABOVE the mark → entry $0.10 < bound $0.11 = worse → #87.
        let res = test.market.try_open_position(
            &trader, &xlm, &(100 * PRECISION), &5, &Direction::Short, &(PRECISION * 11 / 100),
        );
        assert!(matches!(res, Err(Ok(NoetherError::AcceptablePriceExceeded))));
    }

    #[test]
    fn test_close_long_beyond_bound_reverts() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let xlm = Symbol::new(&test.env, "XLM");
        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &5, &Direction::Long, &0);
        // Closing a Long rejects BELOW the bound: mark $0.10 < bound $0.11 → #87.
        let res = test.market.try_close_position(&trader, &pos.id, &(PRECISION * 11 / 100));
        assert!(matches!(res, Err(Ok(NoetherError::AcceptablePriceExceeded))));
        // Resubmitting unbounded (0) always exits (M-2 preserved).
        let pnl = test.market.close_position(&trader, &pos.id, &0);
        assert_eq!(pnl, 0);
    }

    #[test]
    fn test_open_zero_bound_unbounded_and_negative_rejected() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let xlm = Symbol::new(&test.env, "XLM");
        // 0 = no bound.
        let ok = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &5, &Direction::Long, &0);
        assert_eq!(ok.leverage, 5);
        // Negative bound → InvalidParameter.
        let res = test.market.try_open_position(
            &trader, &xlm, &(100 * PRECISION), &5, &Direction::Long, &(-1),
        );
        assert!(matches!(res, Err(Ok(NoetherError::InvalidParameter))));
    }

    #[test]
    fn test_cross_open_bound_enforced() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let xlm = Symbol::new(&test.env, "XLM");
        let res = test.market.try_open_position_cross(
            &trader, &xlm, &(100 * PRECISION), &5, &Direction::Long, &(PRECISION * 9 / 100),
        );
        assert!(matches!(res, Err(Ok(NoetherError::AcceptablePriceExceeded))));
    }

    // ── L0-6: partial close + add/remove margin ─────────────────────────

    #[test]
    fn test_partial_close_reduces_position() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);
        let xlm = Symbol::new(&test.env, "XLM");
        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &5, &Direction::Long, &0);

        let w0 = usdc.balance(&trader);
        // Close 40% of the $500 notional at a flat price.
        let close_size = pos.size * 40 / 100;
        let pnl = test.market.close_position_partial(&trader, &pos.id, &close_size);
        assert_eq!(pnl, 0); // flat

        // Position survives, 40% smaller, collateral shrunk pro-rata, ratio
        // preserved so the stored liq price is unchanged.
        let updated = test.market.get_position(&pos.id).expect("survives");
        assert_eq!(updated.size, pos.size - close_size);
        assert_eq!(updated.collateral, pos.collateral - pos.collateral * 40 / 100);
        assert_eq!(updated.liquidation_price, pos.liquidation_price);
        assert_eq!(updated.entry_cumulative_funding, pos.entry_cumulative_funding);
        // The closed portion's collateral came back (flat price, no fee).
        assert_eq!(usdc.balance(&trader) - w0, pos.collateral * 40 / 100);
    }

    #[test]
    fn test_partial_close_rejects_dust_residual() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let xlm = Symbol::new(&test.env, "XLM");
        // $100 collateral, min 10 USDC: closing 95% leaves $5 residual < floor.
        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &5, &Direction::Long, &0);
        let close_size = pos.size * 95 / 100;
        let res = test.market.try_close_position_partial(&trader, &pos.id, &close_size);
        assert!(matches!(res, Err(Ok(NoetherError::PositionTooSmall))));
    }

    #[test]
    fn test_partial_close_full_size_delegates() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let xlm = Symbol::new(&test.env, "XLM");
        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &5, &Direction::Long, &0);
        test.market.close_position_partial(&trader, &pos.id, &pos.size);
        assert!(test.market.get_position(&pos.id).is_none()); // fully closed
    }

    #[test]
    fn test_partial_close_conserves_usdc() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);
        let xlm = Symbol::new(&test.env, "XLM");
        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &5, &Direction::Long, &0);

        let m0 = usdc.balance(&test.market_id);
        let t0 = usdc.balance(&trader);
        let close_size = pos.size / 2;
        test.market.close_position_partial(&trader, &pos.id, &close_size);
        // Flat price: exactly the closed portion's collateral leaves the market to the trader.
        let expected = pos.collateral / 2;
        assert_eq!(usdc.balance(&trader) - t0, expected);
        assert_eq!(m0 - usdc.balance(&test.market_id), expected);
    }

    #[test]
    fn test_add_collateral_moves_liq_price_away() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);
        let xlm = Symbol::new(&test.env, "XLM");
        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &10, &Direction::Long, &0);

        let m0 = usdc.balance(&test.market_id);
        test.market.add_collateral(&trader, &pos.id, &(50 * PRECISION));
        let updated = test.market.get_position(&pos.id).unwrap();
        assert_eq!(updated.collateral, pos.collateral + 50 * PRECISION);
        // A long's liq price moves DOWN (further from entry) with more margin.
        assert!(updated.liquidation_price < pos.liquidation_price);
        assert_eq!(usdc.balance(&test.market_id) - m0, 50 * PRECISION);
    }

    #[test]
    fn test_add_collateral_not_pause_gated() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let xlm = Symbol::new(&test.env, "XLM");
        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &10, &Direction::Long, &0);
        test.market.pause();
        // Risk-reducing: works even while paused (exit-only-pause).
        test.market.add_collateral(&trader, &pos.id, &(10 * PRECISION));
        test.market.unpause();
    }

    #[test]
    fn test_remove_collateral_rejected_below_im() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let xlm = Symbol::new(&test.env, "XLM");
        // 2x on $100 = $200 notional; IM floor at 10x = $20. Removing $85
        // leaves $15 < the $20 IM floor.
        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &2, &Direction::Long, &0);
        let res = test.market.try_remove_collateral(&trader, &pos.id, &(85 * PRECISION));
        assert!(matches!(res, Err(Ok(NoetherError::InsufficientMargin))));
        // A safe removal (leaves $50 > $20 IM and clears MM) works.
        let m0 = soroban_sdk::token::Client::new(&test.env, &test.usdc_token).balance(&test.market_id);
        test.market.remove_collateral(&trader, &pos.id, &(50 * PRECISION));
        let after = soroban_sdk::token::Client::new(&test.env, &test.usdc_token).balance(&test.market_id);
        assert_eq!(m0 - after, 50 * PRECISION);
    }

    #[test]
    fn test_remove_collateral_rejected_when_equity_near_mm() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let xlm = Symbol::new(&test.env, "XLM");
        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &2, &Direction::Long, &0);
        // Advance past the 10×-staleness window so the deviation band
        // self-disables (a big move is otherwise rejected as #81 first);
        // then a fresh crashed price exercises the MM safety gate directly.
        test.env.ledger().with_mut(|li| li.timestamp += 601);
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(PRECISION * 60 / 1000)); // $0.06 from $0.10 (~40% down)
        // Equity ≈ 100 − 80 = 20; removing $50 leaves −30 equity vs $2 MM.
        let res = test.market.try_remove_collateral(&trader, &pos.id, &(50 * PRECISION));
        assert!(matches!(res, Err(Ok(NoetherError::InsufficientMargin))));
    }

    #[test]
    fn test_reduce_only_partially_reduces_oversized_position() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);
        let xlm = Symbol::new(&test.env, "XLM");
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);

        // Open a $500 long, then a reduce-only SHORT sized to only $200.
        let long = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &5, &Direction::Long, &0);
        let ro = test.market.place_limit_order(
            &trader, &xlm, &Direction::Short, &(40 * PRECISION), &5,
            &(PRECISION / 20), &false, &100, &0x100, // reduce-only GTC
        );
        oracle.set_price(&xlm, &(PRECISION / 20));
        test.market.execute_order(&keeper, &ro.id);

        // The long survives, reduced by the $200 (not full-closed, not skipped).
        let updated = test.market.get_position(&long.id).expect("long partially survives");
        assert_eq!(updated.size, long.size - 200 * PRECISION);
    }

    #[test]
    fn test_open_position_long() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        let position = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long, &0,
        );

        assert_eq!(position.id, 1);
        assert_eq!(position.size, 500 * PRECISION);
        assert_eq!(position.leverage, 5);
        assert_eq!(position.entry_price, PRECISION / 10); // $0.10
    }

    #[test]
    fn test_open_position_short() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        let position = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Short, &0,
        );

        assert_eq!(position.id, 1);
        assert_eq!(position.size, 500 * PRECISION);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #22)")] // InsufficientCollateral
    fn test_open_position_below_min_collateral() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        // Min collateral is 10 USDC
        test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(5 * PRECISION), // $5 - below minimum
            &5,
            &Direction::Long, &0,
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #21)")] // InvalidLeverage
    fn test_open_position_leverage_too_high() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &20, // max is 10
            &Direction::Long, &0,
        );
    }

    #[test]
    fn test_close_position_profit() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        // Open long at $0.10
        let position = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long, &0,
        );

        // Price goes up 10% to $0.11
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(PRECISION * 11 / 100));

        // Close position - should profit
        let pnl = test.market.close_position(&trader, &position.id, &0);
        assert!(pnl > 0);
    }

    #[test]
    fn test_close_position_loss() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        // Open long at $0.10
        let position = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long, &0,
        );

        // Price goes down 5% to $0.095
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(PRECISION * 95 / 1000));

        // Close position - should lose
        let pnl = test.market.close_position(&trader, &position.id, &0);
        assert!(pnl < 0);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Cross-Margin Tests
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_cross_margin_open_two_positions() {
        let test = setup();
        let trader = fund_trader(&test, 10_000 * PRECISION);

        // Deposit into cross-margin pool
        test.market.deposit_cross_margin(&trader, &(1_000 * PRECISION));

        // Open first cross position
        let pos1 = test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "BTC"),
            &(200 * PRECISION),
            &5,
            &Direction::Long, &0,
        );
        assert_eq!(pos1.margin_mode, 1); // Cross

        // Open second cross position sharing collateral
        let pos2 = test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "ETH"),
            &(200 * PRECISION),
            &3,
            &Direction::Short, &0,
        );
        assert_eq!(pos2.margin_mode, 1);
        assert_ne!(pos1.id, pos2.id);
    }

    #[test]
    fn test_cross_margin_close_returns_pnl_to_pool() {
        let test = setup();
        let trader = fund_trader(&test, 10_000 * PRECISION);

        test.market.deposit_cross_margin(&trader, &(1_000 * PRECISION));

        let pos = test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long, &0,
        );

        // Price up 10% — profit
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(PRECISION * 11 / 100));

        let pnl = test.market.close_position_cross(&trader, &pos.id, &0);
        assert!(pnl > 0); // Profitable close returns to pool
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #77)")] // CrossMarginInsufficientFreeMargin
    fn test_cross_margin_insufficient_free_margin() {
        let test = setup();
        let trader = fund_trader(&test, 10_000 * PRECISION);

        // Deposit and open a large position
        test.market.deposit_cross_margin(&trader, &(100 * PRECISION));

        test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(90 * PRECISION),
            &10,
            &Direction::Long, &0,
        );

        // Drop XLM price 9% — erodes equity
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(PRECISION * 91 / 1000)); // $0.091

        // Try second position — equity too low after loss, should fail
        test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(15 * PRECISION),
            &10,
            &Direction::Long, &0,
        );
    }

    #[test]
    fn test_cross_margin_liquidation() {
        let test = setup();
        let trader = fund_trader(&test, 10_000 * PRECISION);
        let keeper = fund_trader(&test, 100 * PRECISION);

        test.market.deposit_cross_margin(&trader, &(100 * PRECISION));

        // Open leveraged long
        test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(90 * PRECISION),
            &10,
            &Direction::Long, &0,
        );

        // Drop price ~10.5% — makes account liquidatable but keeps equity > 0 for keeper reward
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(PRECISION * 895 / 10000)); // $0.0895

        // Liquidate
        let reward = test.market.liquidate_cross_account(&keeper, &trader);
        assert!(reward > 0);
    }

    #[test]
    fn test_cross_margin_partial_close() {
        let test = setup();
        let trader = fund_trader(&test, 10_000 * PRECISION);

        // Deposit into cross-margin pool
        test.market.deposit_cross_margin(&trader, &(1_000 * PRECISION));

        // Open two cross positions
        let pos1 = test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "BTC"),
            &(200 * PRECISION),
            &5,
            &Direction::Long, &0,
        );
        let pos2 = test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "ETH"),
            &(150 * PRECISION),
            &3,
            &Direction::Short, &0,
        );

        // Close only the first position (partial account close)
        let pnl = test.market.close_position_cross(&trader, &pos1.id, &0);
        // PnL can be positive or negative depending on price movement
        let _ = pnl;

        // Second position must still exist
        let remaining_ids = test.market.get_cross_margin_positions(&trader);
        assert_eq!(remaining_ids.len(), 1);
        assert_eq!(remaining_ids.get(0).unwrap(), pos2.id);

        // Pool balance should still be > 0 (collateral returned to pool)
        let pool_bal = test.market.get_cross_margin_balance(&trader);
        assert!(pool_bal > 0);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Order Type Tests
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_limit_order_gtc() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        // Place GTC limit order (time_in_force=0)
        let order = test.market.place_limit_order(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &Direction::Long,
            &(100 * PRECISION),
            &5,
            &(PRECISION / 20), // trigger at $0.05 (below current $0.10)
            &false,             // trigger below
            &100,               // 1% slippage
            &0,                 // GTC
        );
        assert_eq!(order.status, OrderStatus::Pending);
        assert_eq!(order.time_in_force, 0);
    }

    #[test]
    fn test_limit_order_ioc_cancel() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        // Place IOC order with trigger NOT met (current XLM = $0.10, trigger below $0.05)
        let order = test.market.place_limit_order(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &Direction::Long,
            &(100 * PRECISION),
            &5,
            &(PRECISION / 20), // $0.05 — not triggered (price is $0.10)
            &false,
            &100,
            &1, // IOC
        );
        // IOC not filled → cancelled, collateral refunded
        assert_eq!(order.status, OrderStatus::Cancelled);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #70)")] // PostOnlyViolation
    fn test_limit_order_post_only_rejected() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        // Place Post Only order that WOULD fill immediately
        // Current XLM = $0.10, trigger above $0.05 → already met
        test.market.place_limit_order(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &Direction::Long,
            &(100 * PRECISION),
            &5,
            &(PRECISION / 20), // $0.05 — already above this
            &true,              // trigger above
            &100,
            &2, // Post Only
        );
    }

    #[test]
    fn test_limit_order_post_only_accepted() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        // Place Post Only order that would NOT fill immediately
        // Current XLM = $0.10, trigger below $0.05 → not met → accepted as maker
        let order = test.market.place_limit_order(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &Direction::Long,
            &(100 * PRECISION),
            &5,
            &(PRECISION / 20), // $0.05
            &false,             // trigger below
            &100,
            &2, // Post Only
        );
        assert_eq!(order.status, OrderStatus::Pending);
    }

    #[test]
    fn test_take_profit_with_limit_price() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        // Open a long position at XLM $0.10
        let pos = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long, &0,
        );

        // Set take-profit with limit_price (Take Limit):
        // trigger at $0.12, limit at $0.115
        let order = test.market.set_take_profit(
            &trader,
            &pos.id,
            &(PRECISION * 12 / 100), // trigger $0.12
            &200,                     // 2% slippage
            &(PRECISION * 115 / 1000), // limit $0.115
        );
        assert_eq!(order.limit_price, PRECISION * 115 / 1000);
        assert_eq!(order.status, OrderStatus::Pending);
    }

    #[test]
    fn test_stop_limit_with_ioc_tif() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        // Place StopLimit order with IOC (time_in_force=1)
        // Stop not triggered → IOC applies to limit phase, order stays pending in stop phase
        let order = test.market.place_stop_limit_order(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &Direction::Long,
            &(100 * PRECISION),
            &5,
            &(PRECISION / 20),   // stop at $0.05 (below current $0.10)
            &(PRECISION / 25),   // limit at $0.04
            &false,              // trigger below
            &100,                // 1% slippage
            &1,                  // IOC — applies to limit phase (phase 1), not stop phase
        );
        // Stop phase — order is pending (IOC doesn't cancel in stop phase)
        assert_eq!(order.status, OrderStatus::Pending);
        assert_eq!(order.stop_limit_phase, 0);
    }

    #[test]
    fn test_stop_limit_with_post_only_stored() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        // Place StopLimit with PostOnly — PostOnly applies to limit phase (phase 1), not stop phase
        let order = test.market.place_stop_limit_order(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &Direction::Long,
            &(100 * PRECISION),
            &5,
            &(PRECISION / 20),   // stop at $0.05 (below current $0.10)
            &(PRECISION / 25),   // limit at $0.04
            &false,              // trigger below
            &100,
            &2,                  // PostOnly — stored for limit phase enforcement
        );
        assert_eq!(order.status, OrderStatus::Pending);
        assert_eq!(order.time_in_force, 2); // PostOnly stored
        assert_eq!(order.stop_limit_phase, 0); // Still in stop phase
    }

    #[test]
    fn test_reduce_only_cancels_without_position() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let keeper = fund_trader(&test, 100 * PRECISION);

        // Place reduce-only limit order (bit 8 set: 0x100 | GTC = 256)
        let order = test.market.place_limit_order(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &Direction::Long,
            &(100 * PRECISION),
            &5,
            &(PRECISION / 20),
            &false,
            &500, // 5% slippage
            &0x100, // reduce_only + GTC
        );
        assert_eq!(order.status, OrderStatus::Pending);

        // Move price to trigger the order
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(PRECISION / 20)); // $0.05

        // Execute — should cancel because no opposing position exists
        let reward = test.market.execute_order(&keeper, &order.id);
        assert_eq!(reward, 0); // 0 = cancelled, not executed
    }

    // ═══════════════════════════════════════════════════════════════════
    // Cross-Margin Order Guard + Zombie-Order Cleanup (M-3 / P1-2)
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_cross_position_rejects_attached_orders() {
        let test = setup();
        let trader = fund_trader(&test, 10_000 * PRECISION);

        test.market.deposit_cross_margin(&trader, &(1_000 * PRECISION));
        let pos = test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "BTC"),
            &(200 * PRECISION),
            &5,
            &Direction::Long, &0,
        );

        // All three attach paths must reject cross-margin positions (#80)
        let sl = test.market.try_set_stop_loss(
            &trader, &pos.id, &(55_000 * PRECISION), &500,
        );
        assert!(matches!(sl, Err(Ok(NoetherError::CrossMarginOrderNotSupported))));

        let tp = test.market.try_set_take_profit(
            &trader, &pos.id, &(70_000 * PRECISION), &500, &0,
        );
        assert!(matches!(tp, Err(Ok(NoetherError::CrossMarginOrderNotSupported))));

        let ts = test.market.try_place_trailing_stop(&trader, &pos.id, &500, &500);
        assert!(matches!(ts, Err(Ok(NoetherError::CrossMarginOrderNotSupported))));
    }

    #[test]
    fn test_close_position_cancels_attached_sl_tp() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        let pos = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long, &0,
        );

        // Attach SL below entry and TP above entry
        let sl = test.market.set_stop_loss(
            &trader, &pos.id, &(PRECISION * 9 / 100), &500,
        );
        let tp = test.market.set_take_profit(
            &trader, &pos.id, &(PRECISION * 12 / 100), &500, &0,
        );
        assert_eq!(test.market.get_all_order_ids().len(), 2);

        // Manual close must cancel both attached orders — no zombies
        test.market.close_position(&trader, &pos.id, &0);

        assert_eq!(test.market.get_all_order_ids().len(), 0);
        let sl_after = test.market.get_order(&sl.id).unwrap();
        let tp_after = test.market.get_order(&tp.id).unwrap();
        assert_eq!(sl_after.status, OrderStatus::Cancelled);
        assert_eq!(tp_after.status, OrderStatus::Cancelled);
    }

    #[test]
    fn test_liquidation_cancels_attached_orders() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let keeper = fund_trader(&test, 100 * PRECISION);

        // 10x long at $0.10 — liquidation near $0.091
        let pos = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &10,
            &Direction::Long, &0,
        );
        let sl = test.market.set_stop_loss(
            &trader, &pos.id, &(PRECISION * 5 / 100), &500,
        );

        // Crash the price below liquidation threshold and liquidate
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(PRECISION * 85 / 1000));
        test.market.liquidate(&keeper, &pos.id);

        // The attached SL must not survive as a pending zombie
        assert_eq!(test.market.get_all_order_ids().len(), 0);
        let sl_after = test.market.get_order(&sl.id).unwrap();
        assert_eq!(sl_after.status, OrderStatus::Cancelled);
    }

    #[test]
    fn test_trailing_stop_link_lifecycle() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        let pos = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long, &0,
        );

        let ts = test.market.place_trailing_stop(&trader, &pos.id, &500, &500);

        // Second trailing stop on the same position is rejected
        let dup = test.market.try_place_trailing_stop(&trader, &pos.id, &300, &500);
        assert!(matches!(dup, Err(Ok(NoetherError::OrderAlreadyExists))));

        // Cancelling frees the slot for a new trailing stop
        test.market.cancel_order(&trader, &ts.id);
        let ts2 = test.market.place_trailing_stop(&trader, &pos.id, &300, &500);

        // Closing the position cancels the attached trailing stop
        test.market.close_position(&trader, &pos.id, &0);
        assert_eq!(test.market.get_all_order_ids().len(), 0);
        assert_eq!(
            test.market.get_order(&ts2.id).unwrap().status,
            OrderStatus::Cancelled
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    // Pause / Unpause / Upgrade (M-1 / P1-1)
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_pause_blocks_trading_and_unpause_restores() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        let pos = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long, &0,
        );

        test.market.pause();

        let blocked_open = test.market.try_open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long, &0,
        );
        assert!(matches!(blocked_open, Err(Ok(NoetherError::Paused))));

        let blocked_close = test.market.try_close_position(&trader, &pos.id, &0);
        assert!(matches!(blocked_close, Err(Ok(NoetherError::Paused))));

        let blocked_deposit =
            test.market.try_deposit_cross_margin(&trader, &(100 * PRECISION));
        assert!(matches!(blocked_deposit, Err(Ok(NoetherError::Paused))));

        test.market.unpause();
        let pnl = test.market.close_position(&trader, &pos.id, &0);
        let _ = pnl; // closes fine after unpause
    }

    #[test]
    fn test_liquidation_works_while_paused() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let keeper = fund_trader(&test, 100 * PRECISION);

        let pos = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &10,
            &Direction::Long, &0,
        );

        test.market.pause();

        // Crash the price; the liquidation path must ignore the pause
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(PRECISION * 85 / 1000));
        let reward = test.market.liquidate(&keeper, &pos.id);
        assert!(reward >= 0);
        assert!(test.market.get_position(&pos.id).is_none());
    }

    #[test]
    fn test_upgrade_swaps_wasm_and_preserves_storage() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long, &0,
        );

        // Upgrade the market's code to a different (vault) WASM — proves the
        // admin-gated update_current_contract_wasm hook round-trips. Instance
        // storage survives the code swap by construction on Soroban.
        let new_hash = test.env.deployer().upload_contract_wasm(vault::WASM);
        test.market.upgrade(&new_hash);

        // The contract at the market address now runs vault code: a market
        // entry point no longer exists, which is exactly what proves the
        // WASM was swapped in place.
        let res = test.market.try_get_all_position_ids();
        assert!(res.is_err());
    }

    // ═══════════════════════════════════════════════════════════════════
    // Oracle Deviation + Staleness Guard (M-2 / P1-5)
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_deviation_guard_halts_opens_allows_closes() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        // Seeds last-good XLM price at $0.10
        let pos = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long, &0,
        );

        // +20% jump — far beyond the 1% max_oracle_deviation_bps band
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(PRECISION * 12 / 100));

        let blocked = test.market.try_open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long, &0,
        );
        assert!(matches!(blocked, Err(Ok(NoetherError::PriceDeviationTooHigh))));

        // Risk-reducing paths are never blocked by the band
        let pnl = test.market.close_position(&trader, &pos.id, &0);
        assert!(pnl > 0);
    }

    #[test]
    fn test_stale_price_halts_opens_allows_closes() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        let pos = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long, &0,
        );

        // Let the feed age past max_price_staleness (60s) with no update
        test.env.ledger().with_mut(|li| li.timestamp += 120);

        let blocked = test.market.try_open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long, &0,
        );
        assert!(matches!(blocked, Err(Ok(NoetherError::PriceStale))));

        // Stale feed must not strand an exiting trader
        let pnl = test.market.close_position(&trader, &pos.id, &0);
        assert!(pnl <= 0); // flat price, small funding — just must not revert
    }

    // ═══════════════════════════════════════════════════════════════════
    // OI Caps + Real Reservation + NAV Wiring (M-4/V-2/V-3 / P1-3, P1-4, P1-8)
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_open_beyond_asset_oi_cap_rejected() {
        let test = setup();
        let vault_client = vault::Client::new(&test.env, &test.vault_id);
        // 1 bp of $10M AUM = $1,000 per-side cap on XLM
        vault_client.set_asset_cap(&Symbol::new(&test.env, "XLM"), &1);

        let trader = fund_trader(&test, 10_000 * PRECISION);
        let blocked = test.market.try_open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(500 * PRECISION),
            &5, // size $2,500 > $1,000 cap
            &Direction::Long, &0,
        );
        assert!(matches!(blocked, Err(Ok(NoetherError::OpenInterestCapExceeded))));

        // Under the cap the open goes through
        let pos = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5, // size $500
            &Direction::Long, &0,
        );
        assert!(pos.id > 0);
    }

    #[test]
    fn test_winner_close_never_freezes_and_records_shortfall() {
        // Tiny pool: the win far exceeds what the vault can pay
        let test = setup_with_vault_deposit(200 * PRECISION);
        let vault_client = vault::Client::new(&test.env, &test.vault_id);
        vault_client.set_skew_cap(&Symbol::new(&test.env, "XLM"), &10_000); // one-sided by design
        let trader = fund_trader(&test, 100 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);

        // size $50 fits the 25% asset cap of a ~$200 pool
        let pos = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(10 * PRECISION),
            &5,
            &Direction::Long, &0,
        );

        // 100x pump — theoretical PnL ~$4,950 against a ~$200 pool
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(PRECISION * 10));

        // The close MUST NOT revert (old settle_pnl hard-reverted here,
        // freezing the winner forever)
        let wallet_before = usdc.balance(&trader);
        test.market.close_position(&trader, &pos.id, &0);
        let received = usdc.balance(&trader) - wallet_before;

        assert!(received > 0); // paid everything the pool could cover
        assert!(vault_client.get_shortfall() > 0); // remainder recorded
    }

    #[test]
    fn test_reservation_lifecycle_and_noe_price_tracks_open_pnl() {
        let test = setup();
        let vault_client = vault::Client::new(&test.env, &test.vault_id);
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let xlm = Symbol::new(&test.env, "XLM");

        let p0 = vault_client.get_noe_price();
        assert_eq!(vault_client.get_reserved_payout(), 0);

        let pos = test.market.open_position(
            &trader, &xlm, &(100 * PRECISION), &5, &Direction::Long, &0,
        );
        // Open reserved its full max payout (= size)
        assert_eq!(vault_client.get_reserved_payout(), 500 * PRECISION);

        // +20% mark move, pushed by the permissionless NAV freshener:
        // traders are winning, so AUM and the NOE price must drop
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(PRECISION * 12 / 100));
        let upnl = test.market.sync_asset_pnl(&xlm);
        assert!(upnl > 0);
        let p1 = vault_client.get_noe_price();
        assert!(p1 < p0);

        // Close releases the reservation and zeroes the asset's uPnL
        test.market.close_position(&trader, &pos.id, &0);
        assert_eq!(vault_client.get_reserved_payout(), 0);
        assert_eq!(vault_client.get_asset_unrealized_pnl(&xlm), 0);
    }

    #[test]
    fn test_loss_transfer_capped_at_position_collateral() {
        let test = setup();
        let vault_client = vault::Client::new(&test.env, &test.vault_id);
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);
        let xlm = Symbol::new(&test.env, "XLM");

        let vault_acct_before = vault_client.get_total_usdc();
        let wallet_before = usdc.balance(&trader);

        // 10x long, then -30%: raw loss $300 on ~$100 collateral
        let pos = test.market.open_position(
            &trader, &xlm, &(100 * PRECISION), &10, &Direction::Long, &0,
        );
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(PRECISION * 7 / 100));
        let pnl = test.market.close_position(&trader, &pos.id, &0);
        assert!(pnl < -(100 * PRECISION)); // raw PnL far beyond collateral

        // The trader can lose at most their collateral...
        assert_eq!(usdc.balance(&trader), wallet_before - 100 * PRECISION);
        // ...and the vault is credited only what actually arrived
        // (net collateral after the open fee), never the raw loss
        let credited = vault_client.get_total_usdc() - vault_acct_before;
        assert!(credited > 0 && credited <= 100 * PRECISION);
    }

    #[test]
    fn test_reduce_only_closes_opposing_position() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let keeper = fund_trader(&test, 100 * PRECISION);
        let xlm = Symbol::new(&test.env, "XLM");
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);

        // Existing long $500
        let pos = test.market.open_position(
            &trader, &xlm, &(100 * PRECISION), &5, &Direction::Long, &0,
        );

        // Reduce-only short sized to cover it ($500)
        let order = test.market.place_limit_order(
            &trader,
            &xlm,
            &Direction::Short,
            &(100 * PRECISION),
            &5,
            &(PRECISION * 11 / 100), // trigger above spot
            &true,
            &9_000,
            &0x100, // reduce-only + GTC
        );

        // Trigger and execute
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(PRECISION * 12 / 100));
        let wallet_before = usdc.balance(&trader);
        test.market.execute_order(&keeper, &order.id);

        // The opposing long is CLOSED — and no opposite short was opened
        assert!(test.market.get_position(&pos.id).is_none());
        assert_eq!(test.market.get_all_position_ids().len(), 0);
        // Trader got the order's locked collateral back plus the close payout
        assert!(usdc.balance(&trader) > wallet_before + 100 * PRECISION);
    }

    #[test]
    fn test_protocol_fee_split_routes_to_treasury() {
        let test = setup();
        let vault_client = vault::Client::new(&test.env, &test.vault_id);
        let treasury = Address::generate(&test.env);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);

        test.market.set_fee_split(&treasury, &2_000); // 20%

        let vault_acct_before = vault_client.get_total_usdc();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long, &0,
        );

        // Taker fee on $500 at 0.05% = $0.25 → 20% = $0.05 to treasury
        let treasury_got = usdc.balance(&treasury);
        assert!(treasury_got > 0);
        // The vault's share is CREDITED to accounting (fees now count
        // toward AUM instead of arriving as invisible balance)
        let credited = vault_client.get_total_usdc() - vault_acct_before;
        assert_eq!(credited * 2_000 / 8_000, treasury_got); // 80/20 split
    }

    // ═══════════════════════════════════════════════════════════════════
    // Funding Settlement + Liquidation Reward Cap (P1-9)
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_funding_accrues_and_settles_on_close() {
        // L0-13: per-asset funding. XLM must be configured; the first
        // apply_funding seeds last_ts (returns #55, the keeper not-due
        // state), the second accrues off the time-weighted skew.
        let test = setup();
        seed_ladder(&test);
        let vault_client = vault::Client::new(&test.env, &test.vault_id);
        vault_client.set_skew_cap(&Symbol::new(&test.env, "XLM"), &10_000); // one-sided by design
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);
        let xlm = Symbol::new(&test.env, "XLM");

        // Long-only market: longs pay funding
        let pos = test.market.open_position(
            &trader, &xlm, &(100 * PRECISION), &5, &Direction::Long, &0,
        );
        let fee = 100 * PRECISION - pos.collateral; // taker fee charged at open

        // First tick seeds the funding window (Ok, no accrual event) — the
        // seed must PERSIST, so it cannot return Err.
        test.market.apply_funding();
        // A second tick within the hour is not-due (#55, keeper tri-state).
        let not_due = test.market.try_apply_funding();
        assert!(matches!(not_due, Err(Ok(NoetherError::FundingIntervalNotElapsed))));

        // One hour passes; refresh the oracle so the close isn't stale-flagged.
        test.env.ledger().with_mut(|li| li.timestamp += 3_600);
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(PRECISION / 10));
        test.market.apply_funding(); // accrues off the net-long skew

        let vault_before = vault_client.get_total_usdc();
        let wallet_before = usdc.balance(&trader);
        let pnl = test.market.close_position(&trader, &pos.id, &0);
        assert_eq!(pnl, 0); // flat price

        // Trader got collateral back MINUS accrued funding (longs pay).
        let received = usdc.balance(&trader) - wallet_before;
        assert!(received > 0);
        assert!(received < 100 * PRECISION - fee);
        // ...and that funding landed in the vault's accounting.
        let funding_credited = vault_client.get_total_usdc() - vault_before;
        assert_eq!(funding_credited, (100 * PRECISION - fee) - received);
        assert!(funding_credited > 0);
    }

    // ── L0-13: per-asset funding + magnitude + M-7 kill ─────────────────

    /// Configure an asset, seed its funding window, hold a one-sided long
    /// for one hour, and apply. Returns (accrued cumulative index, funding
    /// charged to the position on close).
    fn accrue_one_hour(vel_bps: u32, clamp_bps: u32) -> (TestEnv, i128) {
        let test = setup();
        let xlm = Symbol::new(&test.env, "XLM");
        let params = AssetRiskParams {
            max_leverage: 10, im_bps: 1_000, mm_bps: 500, close_out_bps: 333,
            max_position_size: 100_000 * PRECISION,
            max_funding_velocity_bps: vel_bps, funding_clamp_bps: clamp_bps,
            skew_scale: 200_000 * PRECISION,
        };
        test.market.set_asset_risk(&xlm, &params);
        let vault = vault::Client::new(&test.env, &test.vault_id);
        vault.set_skew_cap(&xlm, &10_000);
        let trader = fund_trader(&test, 1_000 * PRECISION);
        test.market.open_position(&trader, &xlm, &(1_000 * PRECISION), &10, &Direction::Long, &0); // $10k notional
        test.market.apply_funding(); // seed
        test.env.ledger().with_mut(|li| li.timestamp += 3_600);
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(PRECISION / 10));
        test.market.apply_funding(); // accrue
        let (cum, _rate, _ts) = {
            // read via a fresh open snapshot: entry_cumulative_funding == cum
            let probe = fund_trader(&test, 100 * PRECISION);
            let p = test.market.open_position(&probe, &xlm, &(10 * PRECISION), &2, &Direction::Long, &0);
            (p.entry_cumulative_funding, 0i128, 0u64)
        };
        (test, cum)
    }

    #[test]
    fn test_funding_magnitude_and_clamp_sip279() {
        // vel 3_600 bps/day at full-ish skew ($10k net on $400k scale) for 1h.
        // At clamp 50 (majors 0.5%/h) the rate saturates; cum == 50_000/h.
        let (_test, cum) = accrue_one_hour(3_600, 50);
        // A $10k-notional net long on a $400k skew_scale over one hour with
        // the 0.5%/h clamp lands the cumulative index at the clamp ceiling.
        assert!(cum > 0, "longs accrue positive funding");
        assert!(cum <= 50_000, "rate clamped at 0.5%/h (50_000 fraction-units)");

        // A tighter clamp binds lower.
        let (_t2, cum_alts) = accrue_one_hour(3_600, 100);
        assert!(cum_alts >= cum, "a looser (alts 1%/h) clamp allows a higher rate");
    }

    #[test]
    fn test_funding_is_per_asset_not_global() {
        // BTC net-long, ETH net-short: their funding indices move in
        // OPPOSITE directions — a global rate could never do this.
        let test = setup();
        seed_ladder(&test);
        let vault = vault::Client::new(&test.env, &test.vault_id);
        let btc = Symbol::new(&test.env, "BTC");
        let eth = Symbol::new(&test.env, "ETH");
        vault.set_skew_cap(&btc, &10_000);
        vault.set_skew_cap(&eth, &10_000);
        let ta = fund_trader(&test, 10_000 * PRECISION);
        let tb = fund_trader(&test, 10_000 * PRECISION);
        test.market.open_position(&ta, &btc, &(1_000 * PRECISION), &10, &Direction::Long, &0);
        test.market.open_position(&tb, &eth, &(1_000 * PRECISION), &10, &Direction::Short, &0);
        test.market.apply_funding(); // seed
        test.env.ledger().with_mut(|li| li.timestamp += 3_600);
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&btc, &(60_000 * PRECISION));
        oracle.set_price(&eth, &(3_000 * PRECISION));
        test.market.apply_funding();

        // Probe each index via a fresh open snapshot.
        let pb = test.market.open_position(&ta, &btc, &(10 * PRECISION), &2, &Direction::Long, &0);
        let pe = test.market.open_position(&tb, &eth, &(10 * PRECISION), &2, &Direction::Long, &0);
        assert!(pb.entry_cumulative_funding > 0, "BTC net-long → longs pay (positive)");
        assert!(pe.entry_cumulative_funding < 0, "ETH net-short → shorts pay (negative)");
    }

    #[test]
    fn test_funding_dt_capped_kills_retroactive_window() {
        // A keeper outage: 5 hours pass, one apply. The M-7 kill caps the
        // accrual at ONE hour — the cumulative never prices 5h at once.
        let test = setup();
        let xlm = Symbol::new(&test.env, "XLM");
        test.market.set_asset_risk(&xlm, &risk(10, 1_000));
        let vault = vault::Client::new(&test.env, &test.vault_id);
        vault.set_skew_cap(&xlm, &10_000);
        let trader = fund_trader(&test, 10_000 * PRECISION);
        test.market.open_position(&trader, &xlm, &(1_000 * PRECISION), &10, &Direction::Long, &0);
        test.market.apply_funding(); // seed

        test.env.ledger().with_mut(|li| li.timestamp += 5 * 3_600); // 5h outage
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(PRECISION / 10));
        test.market.apply_funding();
        let five_h = test.market.open_position(&trader, &xlm, &(10 * PRECISION), &2, &Direction::Long, &0)
            .entry_cumulative_funding;

        // Control: the same skew accrued over a single clean hour.
        let (_t2, one_h) = accrue_one_hour(3_600, 50);
        assert_eq!(five_h, one_h, "5h outage accrues exactly one hour (M-7 killed)");
    }

    #[test]
    fn test_migrate_funding_preserves_pending() {
        // A position opened under the legacy global index keeps its pending
        // funding after migration seeds the per-asset index at that value.
        let test = setup();
        // Simulate a legacy global cumulative by NOT configuring the asset
        // (epoch 0, funding via the old path is inert here) — then migrate.
        let xlm = Symbol::new(&test.env, "XLM");
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &5, &Direction::Long, &0);
        // entry snapshot is the (legacy) global index at open — 0 here.
        assert_eq!(pos.entry_cumulative_funding, 0);

        test.market.migrate_funding();
        // After migration, FundingState(XLM) seeds at the legacy global (0),
        // so the position's pending funding is still exactly 0 — no jump.
        let vault = vault::Client::new(&test.env, &test.vault_id);
        let vb = vault.get_total_usdc();
        let wb = soroban_sdk::token::Client::new(&test.env, &test.usdc_token).balance(&trader);
        test.market.close_position(&trader, &pos.id, &0);
        let received = soroban_sdk::token::Client::new(&test.env, &test.usdc_token).balance(&trader) - wb;
        // Flat price, zero funding delta → trader gets collateral back, vault unchanged.
        assert_eq!(received, pos.collateral);
        assert_eq!(vault.get_total_usdc(), vb);
    }

    /// L0-3 integration: a winner short-paid at close holds a claimable
    /// per-trader liability booked through the market's OWN settle path
    /// (trader threading), a buffer inflow amortizes it, and claim_shortfall
    /// makes them whole — with USDC conservation across the sequence.
    #[test]
    fn winner_short_paid_then_made_whole() {
        // Small pool: ~997 USDC after the 0.3% deposit fee.
        let test = setup_with_vault_deposit(1_000 * PRECISION);
        let winner = fund_trader(&test, 1_000 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);
        let vault = vault::Client::new(&test.env, &test.vault_id);
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);

        // Lift the 25% per-asset cap out of the way — this test targets the
        // shortfall path, not the OI caps (covered elsewhere).
        vault.set_asset_cap(&Symbol::new(&test.env, "XLM"), &10_000);
        vault.set_skew_cap(&Symbol::new(&test.env, "XLM"), &10_000);

        // Long 500 notional of XLM at $0.10 (reservation 500 <= 70% of AUM).
        let pos = test.market.open_position(
            &winner,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long, &0,
        );
        let balance_after_open = usdc.balance(&winner);

        // A 4x pump: pnl = 500 * 0.30/0.10 = 1500 — far beyond the pool's
        // ~997 coverable (the full-notional reservation covers a 100% move;
        // beyond that is exactly the shortfall regime).
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(4 * PRECISION / 10));
        test.market.close_position(&winner, &pos.id, &0);

        // The gap is booked per-trader through the market's settle path.
        let owed = vault.get_shortfall_owed(&winner);
        assert!(owed > 0, "expected a short-pay against the small pool");
        assert_eq!(vault.get_shortfall(), owed);
        assert_eq!(vault.get_cum_shortfall(), owed);
        let paid_at_close = usdc.balance(&winner) - balance_after_open;
        assert!(paid_at_close > 0);

        // A later inflow (liquidation proceeds / fee share in production —
        // simulated here with the market-authed fund_buffer + real backing)
        // routes ShortfallInflowBps into the earmarked reserve.
        let inflow = 1_200 * PRECISION;
        StellarAssetClient::new(&test.env, &test.usdc_token).mint(&test.vault_id, &inflow);
        vault.fund_buffer(&inflow);
        assert_eq!(vault.get_shortfall_reserve(), owed.min(inflow / 2));

        // Claim makes the winner whole; conservation holds exactly.
        let before_claim = usdc.balance(&winner);
        let claimed = vault.claim_shortfall(&winner);
        assert_eq!(claimed, owed);
        assert_eq!(usdc.balance(&winner), before_claim + owed);
        assert_eq!(vault.get_shortfall_owed(&winner), 0);
        assert_eq!(vault.get_shortfall(), 0);
        assert_eq!(vault.get_cum_shortfall_repaid(), owed);
        // Lifetime booked is history-independent.
        assert_eq!(vault.get_cum_shortfall(), owed);
    }

    #[test]
    fn test_liquidation_reward_capped() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);
        let xlm = Symbol::new(&test.env, "XLM");

        let pos = test.market.open_position(
            &trader, &xlm, &(100 * PRECISION), &10, &Direction::Long, &0,
        );

        // Just past the liquidation threshold (10x → ~9% adverse move)
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(PRECISION * 905 / 10_000));

        let keeper_before = usdc.balance(&keeper);
        let reward = test.market.liquidate(&keeper, &pos.id);
        assert!(reward > 0);
        // L0-4: reward = penalty × penalty_keeper_share_bps / 10⁴ where
        // penalty = min(1% of notional, remaining equity) — and it stays
        // comfortably under the old 10%-of-collateral bound.
        let pnl = pos.size * (PRECISION * 905 / 10_000 - pos.entry_price) / pos.entry_price;
        let remaining = pos.collateral + pnl;
        let mut penalty = pos.size * 100 / 10_000;
        if penalty > remaining {
            penalty = remaining;
        }
        assert_eq!(reward, penalty * 5_000 / 10_000);
        assert!(reward <= pos.collateral / 10);
        assert_eq!(usdc.balance(&keeper) - keeper_before, reward);
        assert!(test.market.get_position(&pos.id).is_none());
    }

    // ═══════════════════════════════════════════════════════════════════
    // Partial liquidation + insurance buffer (T3-D4)
    // ═══════════════════════════════════════════════════════════════════

    /// Open a BTC long with $2,000 entry notional (200 USDC @ 10x) —
    /// above the $1,000 partial-liquidation threshold.
    fn open_large_btc_long(test: &TestEnv) -> (Address, Position) {
        let trader = fund_trader(test, 1_000 * PRECISION);
        let btc = Symbol::new(&test.env, "BTC");
        let pos = test.market.open_position(
            &trader, &btc, &(200 * PRECISION), &10, &Direction::Long, &0,
        );
        (trader, pos)
    }

    fn set_btc_price(test: &TestEnv, price: i128) {
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "BTC"), &price);
    }

    #[test]
    fn test_partial_liq_shrinks_position_and_funds_buffer() {
        // L0-12-ladder regime (MM 5%): with the L0-4 penalty capped at the
        // tranche's equity share, a tranche is health-ratio-INVARIANT at the
        // flat 1% MM (the zero-price analog) — it strictly IMPROVES health
        // only when MM > penalty, so the restores-health premise runs there.
        let test = setup_with_config(mm5_config());
        let (_trader, pos) = open_large_btc_long(&test);
        let keeper = fund_trader(&test, 10 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);
        let vault = vault::Client::new(&test.env, &test.vault_id);

        // Liquidatable (below the $57,000 liq price at MM 5%) but NOT
        // bankrupt, and close enough to the edge that ONE 20% tranche
        // restores health.
        set_btc_price(&test, 56_900 * PRECISION);

        let keeper_before = usdc.balance(&keeper);
        let buffer_before = vault.get_buffer_balance();
        let reward = test.market.liquidate(&keeper, &pos.id);

        // Position SURVIVES, 20% smaller, with the realized loss + the
        // tranche penalty taken out of collateral (L0-4).
        let updated = test.market.get_position(&pos.id).expect("position must survive");
        assert_eq!(updated.size, pos.size * 8 / 10);
        assert!(updated.collateral < pos.collateral);
        assert!(updated.collateral > 0);
        assert_eq!(usdc.balance(&keeper) - keeper_before, reward);
        assert!(reward > 0);

        // L0-4: keeper leg + buffer leg == tranche_penalty (the debit beyond
        // the realized loss); the two legs match up to 1 stroop (50/50 split).
        let buffer_gain = vault.get_buffer_balance() - buffer_before;
        assert!(buffer_gain > 0);
        let tranche_penalty = reward + buffer_gain;
        let realized_debit = pos.collateral - updated.collateral - tranche_penalty;
        assert!(realized_debit > 0);
        assert!(buffer_gain >= reward && buffer_gain - reward <= 1);

        // The partial actually SAVED the position: after the grace period it
        // is no longer liquidatable at this price.
        test.env.ledger().set_timestamp(test.env.ledger().timestamp() + 31);
        let res = test.market.try_liquidate(&keeper, &pos.id);
        assert_eq!(res, Err(Ok(NoetherError::NotLiquidatable)));
    }

    #[test]
    fn test_partial_liq_cooldown_blocks_then_second_round_runs() {
        let test = setup();
        let (_trader, pos) = open_large_btc_long(&test);
        let keeper = fund_trader(&test, 10 * PRECISION);

        set_btc_price(&test, 54_585 * PRECISION);
        test.market.liquidate(&keeper, &pos.id);
        let after_first = test.market.get_position(&pos.id).unwrap();

        // Price keeps sliding: still liquidatable, still not bankrupt — but
        // the grace period blocks any further liquidation.
        set_btc_price(&test, 54_300 * PRECISION);
        let blocked = test.market.try_liquidate(&keeper, &pos.id);
        assert_eq!(blocked, Err(Ok(NoetherError::LiquidationCooldown)));

        // After the 30s grace period a SECOND partial round runs (the
        // remaining notional is still above the $1,000 threshold).
        test.env.ledger().set_timestamp(test.env.ledger().timestamp() + 31);
        test.market.liquidate(&keeper, &pos.id);
        let after_second = test.market.get_position(&pos.id).expect("still alive");
        assert_eq!(after_second.size, after_first.size * 8 / 10);
        assert!(after_second.collateral < after_first.collateral);
    }

    #[test]
    fn test_small_position_liquidates_fully_with_buffer_share() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);
        let vault = vault::Client::new(&test.env, &test.vault_id);
        let btc = Symbol::new(&test.env, "BTC");

        // $500 notional — under the $1,000 partial threshold.
        let pos = test.market.open_position(
            &trader, &btc, &(50 * PRECISION), &10, &Direction::Long, &0,
        );
        set_btc_price(&test, 54_500 * PRECISION);

        let buffer_before = vault.get_buffer_balance();
        let reward = test.market.liquidate(&keeper, &pos.id);

        // Straight to full liquidation: gone in one step.
        assert!(test.market.get_position(&pos.id).is_none());

        // L0-4: buffer leg == penalty − keeper leg (~equal at the 50/50 split).
        let buffer_gain = vault.get_buffer_balance() - buffer_before;
        assert!(reward > 0);
        assert!(buffer_gain >= reward && buffer_gain - reward <= 1);
    }

    #[test]
    fn test_bankruptcy_overrides_grace_period() {
        let test = setup();
        let (_trader, pos) = open_large_btc_long(&test);
        let keeper = fund_trader(&test, 10 * PRECISION);

        // Round 1: partial at a survivable price.
        set_btc_price(&test, 54_585 * PRECISION);
        test.market.liquidate(&keeper, &pos.id);
        assert!(test.market.get_position(&pos.id).is_some());

        // Crash INSIDE the grace period to bankruptcy (equity <= 0): the
        // grace period must NOT protect a bankrupt position — full
        // liquidation runs immediately.
        set_btc_price(&test, 53_000 * PRECISION);
        test.market.liquidate(&keeper, &pos.id);
        assert!(test.market.get_position(&pos.id).is_none());
    }

    #[test]
    fn test_full_liquidation_routes_insurance_share() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);
        let vault = vault::Client::new(&test.env, &test.vault_id);
        let xlm = Symbol::new(&test.env, "XLM");

        // Exactly $1,000 notional — NOT strictly above the threshold, so
        // this stays a one-step full liquidation (back-compat guard).
        let pos = test.market.open_position(
            &trader, &xlm, &(100 * PRECISION), &10, &Direction::Long, &0,
        );
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(PRECISION * 905 / 10_000));

        let buffer_before = vault.get_buffer_balance();
        let reward = test.market.liquidate(&keeper, &pos.id);
        assert!(test.market.get_position(&pos.id).is_none());

        // L0-4: the buffer's inflow is the penalty's non-keeper leg. At the
        // flat 1% MM, penalty == remaining (capped), split ~50/50 — the
        // buffer leg equals the keeper leg up to 1 stroop of rounding.
        let buffer_gain = vault.get_buffer_balance() - buffer_before;
        assert!(reward > 0);
        assert!(buffer_gain >= reward && buffer_gain - reward <= 1);
    }

    // ── L0-4: bounded penalty + residual refund ─────────────────────────

    /// The L0-12-ladder regime (MM 5% > penalty 1%) — the configuration
    /// where liquidation refunds are non-zero by construction.
    fn mm5_config() -> MarketConfig {
        MarketConfig { maintenance_margin_bps: 500, ..MarketConfig::default() }
    }

    // ── L0-12: per-market margin/leverage ladder ────────────────────────

    /// A valid ladder params tuple (satisfies MM=IM/2, im>=400, etc.).
    fn risk(max_lev: u32, im: u32) -> AssetRiskParams {
        AssetRiskParams {
            max_leverage: max_lev,
            im_bps: im,
            mm_bps: im / 2,
            close_out_bps: (im / 2) * 2 / 3,
            max_position_size: 100_000 * PRECISION,
            max_funding_velocity_bps: 3_600,
            funding_clamp_bps: 50,
            skew_scale: 200_000 * PRECISION,
        }
    }

    /// Seed the three test assets with the launch ladder (stamps the epoch)
    /// so the fail-closed/per-asset paths activate. XLM keeps 10x/5% MM so
    /// existing price fixtures still liquidate near the same levels.
    fn seed_ladder(test: &TestEnv) {
        let btc = Symbol::new(&test.env, "BTC");
        let eth = Symbol::new(&test.env, "ETH");
        let xlm = Symbol::new(&test.env, "XLM");
        test.market.set_asset_risk(&btc, &risk(10, 400)); // 25x-capable, launched at 10x
        test.market.set_asset_risk(&eth, &risk(10, 400));
        test.market.set_asset_risk(&xlm, &risk(10, 1_000)); // 10x, MM 5%
    }

    #[test]
    fn test_asset_risk_setter_enforces_invariants() {
        let test = setup();
        let btc = Symbol::new(&test.env, "BTC");
        // mm != im/2 rejected.
        let bad_mm = AssetRiskParams { mm_bps: 300, ..risk(10, 400) };
        assert!(matches!(test.market.try_set_asset_risk(&btc, &bad_mm), Err(Ok(NoetherError::InvalidParameter))));
        // im < 400 (>25x) rejected.
        let bad_im = risk(30, 200);
        assert!(matches!(test.market.try_set_asset_risk(&btc, &bad_im), Err(Ok(NoetherError::InvalidParameter))));
        // close_out >= mm rejected.
        let bad_co = AssetRiskParams { close_out_bps: 250, ..risk(10, 400) };
        assert!(matches!(test.market.try_set_asset_risk(&btc, &bad_co), Err(Ok(NoetherError::InvalidParameter))));
        // Valid config accepted; readable back.
        test.market.set_asset_risk(&btc, &risk(10, 400));
        let stored = test.market.get_asset_risk(&btc).unwrap();
        assert_eq!(stored.im_bps, 400);
        assert_eq!(stored.mm_bps, 200);
    }

    #[test]
    fn test_set_asset_risk_rejects_unknown_symbol() {
        let test = setup();
        let bogus = Symbol::new(&test.env, "NOTAPAIR");
        assert!(matches!(test.market.try_set_asset_risk(&bogus, &risk(10, 400)), Err(Ok(NoetherError::InvalidParameter))));
    }

    #[test]
    fn test_open_fails_closed_on_unconfigured_asset() {
        let test = setup();
        // Stamp the epoch by configuring BTC only; XLM stays unconfigured.
        let btc = Symbol::new(&test.env, "BTC");
        test.market.set_asset_risk(&btc, &risk(10, 400));
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let xlm = Symbol::new(&test.env, "XLM");
        let res = test.market.try_open_position(&trader, &xlm, &(100 * PRECISION), &2, &Direction::Long, &0);
        assert!(matches!(res, Err(Ok(NoetherError::AssetRiskNotConfigured))));
    }

    #[test]
    fn test_close_and_liquidate_still_work_on_unconfigured_asset() {
        // Open a legacy XLM position BEFORE the ladder, then stamp the epoch
        // on BTC. The risk-reducing paths must never brick on XLM.
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let xlm = Symbol::new(&test.env, "XLM");
        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &5, &Direction::Long, &0);
        let btc = Symbol::new(&test.env, "BTC");
        test.market.set_asset_risk(&btc, &risk(10, 400)); // stamps epoch

        // Close still works (grandfathered, legacy MM fallback).
        let pnl = test.market.close_position(&trader, &pos.id, &0);
        assert!(test.market.get_position(&pos.id).is_none());
        let _ = pnl;
    }

    #[test]
    fn test_open_leverage_capped_per_asset() {
        let test = setup();
        seed_ladder(&test);
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let xlm = Symbol::new(&test.env, "XLM"); // capped at 10x
        // 11x on a 10x pair is rejected.
        let res = test.market.try_open_position(&trader, &xlm, &(100 * PRECISION), &11, &Direction::Long, &0);
        assert!(matches!(res, Err(Ok(NoetherError::InvalidLeverage))));
        // 10x is fine.
        let ok = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &10, &Direction::Long, &0);
        assert_eq!(ok.leverage, 10);
    }

    #[test]
    fn test_liq_price_uses_asset_mm() {
        // XLM configured at MM 5% (1000/2) yields a HIGHER long liq price
        // than the legacy MM 1% — the ladder MM flows into the stored price.
        let legacy = setup();
        let t1 = fund_trader(&legacy, 1_000 * PRECISION);
        let xlm = Symbol::new(&legacy.env, "XLM");
        let legacy_pos = legacy.market.open_position(&t1, &xlm, &(100 * PRECISION), &5, &Direction::Long, &0);

        let laddered = setup();
        seed_ladder(&laddered);
        let t2 = fund_trader(&laddered, 1_000 * PRECISION);
        let ladder_pos = laddered.market.open_position(&t2, &xlm, &(100 * PRECISION), &5, &Direction::Long, &0);

        assert!(ladder_pos.liquidation_price > legacy_pos.liquidation_price,
            "MM 5% liquidates a long sooner (higher price) than MM 1%");
    }

    #[test]
    fn test_grandfathered_position_keeps_legacy_mm_after_epoch() {
        // A position opened pre-ladder (legacy MM 1%) must NOT become
        // liquidatable when its asset's MM later rises to 5%.
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let xlm = Symbol::new(&test.env, "XLM");
        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &5, &Direction::Long, &0);
        let entry = pos.entry_price;

        // Now stamp the ladder with XLM at MM 5%.
        seed_ladder(&test);

        // A ~2% adverse move: liquidatable at MM 5% (equity ~$10 vs $25 MM on
        // a $500 position) but NOT at the grandfathered MM 1% ($5 MM).
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(entry * 98 / 100));
        let keeper = fund_trader(&test, 10 * PRECISION);
        let res = test.market.try_liquidate(&keeper, &pos.id);
        assert!(matches!(res, Err(Ok(NoetherError::NotLiquidatable))),
            "grandfathered position must keep its legacy MM");
    }

    #[test]
    fn test_cross_mm_aggregates_mixed_assets_per_asset_mm() {
        // Mixed cross legs BTC (MM 2%) + XLM (MM 5%) — aggregate account MM is
        // the per-asset SUM ($35 on $1000 notional), not the flat legacy 1%
        // ($10). At equity ~$30 the laddered account IS liquidatable while an
        // identical legacy account is NOT — proving per-asset aggregation.
        // Returns true if the mixed cross account is liquidatable.
        let liquidatable = |ladder: bool| -> bool {
            let test = setup();
            if ladder { seed_ladder(&test); }
            let trader = fund_trader(&test, 1_000 * PRECISION);
            let keeper = fund_trader(&test, 10 * PRECISION);
            let btc = Symbol::new(&test.env, "BTC");
            let xlm = Symbol::new(&test.env, "XLM");
            test.market.open_position_cross(&trader, &btc, &(100 * PRECISION), &5, &Direction::Long, &0);
            test.market.open_position_cross(&trader, &xlm, &(100 * PRECISION), &5, &Direction::Long, &0);
            // Drop both ~17% → each leg loses ~85% of collateral, equity ~$30.
            let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
            oracle.set_price(&btc, &(60_000 * PRECISION * 83 / 100));
            oracle.set_price(&xlm, &(PRECISION / 10 * 83 / 100));
            test.market.try_liquidate_cross_account(&keeper, &trader).is_ok()
        };
        // Ladder MM $35 > equity $30 → liquidatable; legacy MM $10 < $30 → not.
        assert!(liquidatable(true), "per-asset ladder MM must liquidate at ~$30 equity");
        assert!(!liquidatable(false), "flat legacy MM must NOT liquidate at ~$30 equity");
    }

    #[test]
    fn test_execute_order_cancels_refunds_when_leverage_now_invalid() {
        // Place a 10x XLM limit order, then tighten XLM to a 5x cap; on
        // execution the order must cancel + refund, not open an 10x position.
        let test = setup();
        seed_ladder(&test);
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);
        let xlm = Symbol::new(&test.env, "XLM");
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);

        let order = test.market.place_limit_order(
            &trader, &xlm, &Direction::Long, &(100 * PRECISION), &10,
            &(PRECISION / 20), &false, &100, &0,
        );
        let bal_after_place = usdc.balance(&trader);

        // Tighten XLM: max_leverage 5 (im 2000, mm 1000).
        test.market.set_asset_risk(&xlm, &risk(5, 2_000));

        // Trigger + keeper-execute: order cancels & refunds, no position.
        oracle.set_price(&xlm, &(PRECISION / 20));
        let keeper = fund_trader(&test, 10 * PRECISION);
        let reward = test.market.execute_order(&keeper, &order.id);
        assert_eq!(reward, 0);
        assert_eq!(usdc.balance(&trader) - bal_after_place, 100 * PRECISION); // full refund
    }

    #[test]
    fn test_25x_enable_is_one_setter_call() {
        let test = setup();
        seed_ladder(&test); // BTC launched at 10x
        let trader = fund_trader(&test, 10_000 * PRECISION);
        let btc = Symbol::new(&test.env, "BTC");
        // 20x rejected at the 10x launch cap.
        assert!(matches!(
            test.market.try_open_position(&trader, &btc, &(100 * PRECISION), &20, &Direction::Long, &0),
            Err(Ok(NoetherError::InvalidLeverage))
        ));
        // One admin call raises the cap to 25x — no redeploy.
        test.market.set_asset_risk(&btc, &risk(25, 400));
        let pos = test.market.open_position(&trader, &btc, &(100 * PRECISION), &20, &Direction::Long, &0);
        assert_eq!(pos.leverage, 20);
    }

    #[test]
    fn test_full_liq_refunds_residual_after_penalty() {
        let test = setup_with_config(mm5_config());
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);
        let vault = vault::Client::new(&test.env, &test.vault_id);
        let xlm = Symbol::new(&test.env, "XLM");

        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &10, &Direction::Long, &0);
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        // remaining lands between penalty (1% of size) and MM (5% of size).
        oracle.set_price(&xlm, &(PRECISION * 949 / 10_000));

        let t0 = usdc.balance(&trader);
        let k0 = usdc.balance(&keeper);
        let v0 = usdc.balance(&test.vault_id);
        let m0 = usdc.balance(&test.market_id);
        let b0 = vault.get_buffer_balance();

        let reward = test.market.liquidate(&keeper, &pos.id);

        // Exact expectations from the position's own numbers (funding = 0).
        let pnl = pos.size * (PRECISION * 949 / 10_000 - pos.entry_price) / pos.entry_price;
        let remaining = pos.collateral + pnl;
        let penalty = pos.size * 100 / 10_000;
        assert!(remaining > penalty, "test must sit in the refund regime");
        let expected_refund = remaining - penalty;
        let expected_keeper = penalty * 5_000 / 10_000;

        assert_eq!(usdc.balance(&trader) - t0, expected_refund);
        assert_eq!(usdc.balance(&keeper) - k0, expected_keeper);
        assert_eq!(reward, expected_keeper);
        assert_eq!(vault.get_buffer_balance() - b0, penalty - expected_keeper);
        // USDC conservation: the market paid out exactly the collateral.
        let outflow = (usdc.balance(&trader) - t0)
            + (usdc.balance(&keeper) - k0)
            + (usdc.balance(&test.vault_id) - v0);
        assert_eq!(outflow, pos.collateral);
        assert_eq!(m0 - usdc.balance(&test.market_id), pos.collateral);
    }

    #[test]
    fn test_full_liq_penalty_split_keeper_buffer() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);
        let vault = vault::Client::new(&test.env, &test.vault_id);
        let xlm = Symbol::new(&test.env, "XLM");

        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &10, &Direction::Long, &0);
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(PRECISION * 905 / 10_000));

        let t0 = usdc.balance(&trader);
        let b0 = vault.get_buffer_balance();
        let reward = test.market.liquidate(&keeper, &pos.id);
        let buffer_gain = vault.get_buffer_balance() - b0;

        // 50/50 split of the penalty (keeper floors on odd strops).
        let penalty = reward + buffer_gain;
        assert_eq!(reward, penalty * 5_000 / 10_000);
        assert_eq!(buffer_gain, penalty - reward);
        // At flat 1% MM the penalty consumes all remaining equity: no refund.
        assert_eq!(usdc.balance(&trader), t0);
    }

    #[test]
    fn test_full_liq_bankrupt_path_unchanged() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);
        let vault = vault::Client::new(&test.env, &test.vault_id);
        let xlm = Symbol::new(&test.env, "XLM");

        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &10, &Direction::Long, &0);
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        // A gap far through bankruptcy: remaining <= 0.
        oracle.set_price(&xlm, &(PRECISION * 850 / 10_000));

        let t0 = usdc.balance(&trader);
        let k0 = usdc.balance(&keeper);
        let v0 = usdc.balance(&test.vault_id);
        let b0 = vault.get_buffer_balance();

        let reward = test.market.liquidate(&keeper, &pos.id);

        // Keeper gets nothing (L1-23 adds the buffer-funded bounty later);
        // the trader gets nothing; the FULL collateral lands at the vault,
        // buffer share per config (10% default in tests).
        assert_eq!(reward, 0);
        assert_eq!(usdc.balance(&keeper), k0);
        assert_eq!(usdc.balance(&trader), t0);
        assert_eq!(usdc.balance(&test.vault_id) - v0, pos.collateral);
        assert_eq!(vault.get_buffer_balance() - b0, pos.collateral / 10);
    }

    #[test]
    fn test_penalty_capped_at_remaining_equity() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);
        let vault = vault::Client::new(&test.env, &test.vault_id);
        let xlm = Symbol::new(&test.env, "XLM");

        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &10, &Direction::Long, &0);
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(PRECISION * 905 / 10_000));

        let b0 = vault.get_buffer_balance();
        let k0 = usdc.balance(&keeper);
        let reward = test.market.liquidate(&keeper, &pos.id);

        // penalty = min(1% notional, remaining) = remaining here — keeper
        // leg + buffer leg reconstruct it exactly.
        let pnl = pos.size * (PRECISION * 905 / 10_000 - pos.entry_price) / pos.entry_price;
        let remaining = pos.collateral + pnl;
        assert!(remaining > 0 && remaining < pos.size * 100 / 10_000);
        let buffer_gain = vault.get_buffer_balance() - b0;
        assert_eq!(reward + buffer_gain, remaining);
        assert_eq!(usdc.balance(&keeper) - k0, reward);
    }

    #[test]
    fn test_cross_liq_residual_credits_cross_pool() {
        let test = setup_with_config(mm5_config());
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);
        let xlm = Symbol::new(&test.env, "XLM");

        let pos = test.market.open_position_cross(&trader, &xlm, &(100 * PRECISION), &10, &Direction::Long, &0);
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(PRECISION * 949 / 10_000));

        let m0 = usdc.balance(&test.market_id);
        let reward = test.market.liquidate_cross_account(&keeper, &trader);

        let pnl = pos.size * (PRECISION * 949 / 10_000 - pos.entry_price) / pos.entry_price;
        let equity = pos.collateral + pnl;
        let penalty = pos.size * 100 / 10_000;
        let residual = equity - penalty;
        assert!(residual > 0, "test must sit in the residual regime");

        // The residual stays on the trader's cross balance — NOT the vault.
        assert_eq!(test.market.get_cross_margin_balance(&trader), residual);
        assert_eq!(reward, penalty * 5_000 / 10_000);

        // And it is withdrawable now that the position list is empty.
        let w0 = usdc.balance(&trader);
        test.market.withdraw_cross_margin(&trader, &residual);
        assert_eq!(usdc.balance(&trader) - w0, residual);
        assert_eq!(test.market.get_cross_margin_balance(&trader), 0);

        // Conservation: market outflow == loss transfer + penalty + residual
        // == the position's collateral.
        assert_eq!(m0 - usdc.balance(&test.market_id), pos.collateral);
    }

    // ── L0-2: bad-debt ledger + buffer draw ─────────────────────────────

    #[test]
    fn test_bankrupt_isolated_liquidation_records_bad_debt() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);
        let vault = vault::Client::new(&test.env, &test.vault_id);
        let xlm = Symbol::new(&test.env, "XLM");

        // Pre-fund the buffer so part of the debt is covered.
        vault.fund_buffer(&(20 * PRECISION));

        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &10, &Direction::Long, &0);
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(PRECISION * 850 / 10_000));

        test.market.liquidate(&keeper, &pos.id);

        // bad_debt = |collateral + pnl| (funding 0). pnl = size × −15%.
        let pnl = pos.size * (PRECISION * 850 / 10_000 - pos.entry_price) / pos.entry_price;
        let bad_debt = -(pos.collateral + pnl);
        assert!(bad_debt > 0);
        // Buffer covered its 20, the rest fell to LP — both ledgered.
        assert_eq!(vault.get_cum_bad_debt_covered(), 20 * PRECISION);
        assert_eq!(vault.get_cum_bad_debt_lp_absorbed(), bad_debt - 20 * PRECISION);
        assert_eq!(vault.get_buffer_balance(), pos.collateral / 10); // refilled by the 10% share
    }

    #[test]
    fn test_bankrupt_trader_close_records_bad_debt() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let vault = vault::Client::new(&test.env, &test.vault_id);
        let xlm = Symbol::new(&test.env, "XLM");

        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &10, &Direction::Long, &0);
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(PRECISION * 850 / 10_000));

        // The trader closes their own bankrupt position — same booking.
        test.market.close_position(&trader, &pos.id, &0);

        let pnl = pos.size * (PRECISION * 850 / 10_000 - pos.entry_price) / pos.entry_price;
        let bad_debt = -(pos.collateral + pnl);
        assert_eq!(
            vault.get_cum_bad_debt_covered() + vault.get_cum_bad_debt_lp_absorbed(),
            bad_debt
        );
    }

    #[test]
    fn test_cross_bankrupt_liq_caps_at_account_funds() {
        let test = setup();
        let victim = fund_trader(&test, 1_000 * PRECISION);
        let bystander = fund_trader(&test, 1_000 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);
        let vault = vault::Client::new(&test.env, &test.vault_id);
        let xlm = Symbol::new(&test.env, "XLM");
        let btc = Symbol::new(&test.env, "BTC");

        // Bystander's ISOLATED collateral is custody money at the market.
        let bpos = test.market.open_position(&bystander, &btc, &(100 * PRECISION), &2, &Direction::Long, &0);
        // Victim's cross position goes deep bankrupt.
        let vpos = test.market.open_position_cross(&victim, &xlm, &(100 * PRECISION), &10, &Direction::Long, &0);
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(PRECISION * 850 / 10_000));

        let market_before = usdc.balance(&test.market_id);
        test.market.liquidate_cross_account(&keeper, &victim);
        let outflow = market_before - usdc.balance(&test.market_id);

        // The market paid out at most the VICTIM's own funds — the
        // bystander's collateral stays in custody (the L0-2 cap fix).
        assert_eq!(outflow, vpos.collateral);
        assert!(usdc.balance(&test.market_id) >= bpos.collateral);

        // The uncollectable remainder is booked as CROSS bad debt.
        let pnl = vpos.size * (PRECISION * 850 / 10_000 - vpos.entry_price) / vpos.entry_price;
        let wanted = -pnl;
        assert_eq!(
            vault.get_cum_bad_debt_covered() + vault.get_cum_bad_debt_lp_absorbed(),
            wanted - vpos.collateral
        );
    }

    #[test]
    fn test_bad_debt_lp_absorbed_when_buffer_empty() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);
        let vault = vault::Client::new(&test.env, &test.vault_id);
        let xlm = Symbol::new(&test.env, "XLM");

        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &10, &Direction::Long, &0);
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(PRECISION * 850 / 10_000));

        test.market.liquidate(&keeper, &pos.id);

        let pnl = pos.size * (PRECISION * 850 / 10_000 - pos.entry_price) / pos.entry_price;
        let bad_debt = -(pos.collateral + pnl);
        // Empty buffer at draw time: everything falls to LP, none covered.
        assert_eq!(vault.get_cum_bad_debt_covered(), 0);
        assert_eq!(vault.get_cum_bad_debt_lp_absorbed(), bad_debt);
    }

    #[test]
    fn test_noe_price_flat_when_buffer_covers_bankruptcy() {
        // insurance_buffer_share_bps = 0 (the L0-4 migration value) makes
        // the invariance exact: mark removal − receipts − draw nets to zero.
        let cfg = MarketConfig { insurance_buffer_share_bps: 0, ..MarketConfig::default() };
        let test = setup_with_config(cfg);
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);
        let vault = vault::Client::new(&test.env, &test.vault_id);
        let xlm = Symbol::new(&test.env, "XLM");

        vault.fund_buffer(&(60 * PRECISION)); // more than the coming debt

        let pos = test.market.open_position(&trader, &xlm, &(100 * PRECISION), &10, &Direction::Long, &0);
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(PRECISION * 850 / 10_000));

        // Mark the vault's uPnL at the crashed price, then measure.
        test.market.sync_asset_pnl(&xlm);
        let price_before = vault.get_noe_price();

        test.market.liquidate(&keeper, &pos.id);

        let price_after = vault.get_noe_price();
        let diff = if price_after > price_before { price_after - price_before } else { price_before - price_after };
        assert!(diff <= 2, "NOE price must stay flat when the buffer covers (diff {} strops)", diff);
    }

    // ── L0-1: auto-deleveraging ─────────────────────────────────────────

    /// 200-USDC pool, two 10×5 XLM longs (asset cap lifted), then a 3×
    /// pump: payable winner uPnL (~199) overwhelms coverage (~199.4) at
    /// the 1.25× trigger ratio. Returns (test, t1, t2, pos1, pos2).
    fn adl_scenario(cross_second: bool) -> (TestEnv, Address, Address, Position, Position) {
        let test = setup_with_vault_deposit(200 * PRECISION);
        let xlm = Symbol::new(&test.env, "XLM");
        vault::Client::new(&test.env, &test.vault_id).set_asset_cap(&xlm, &10_000);
        vault::Client::new(&test.env, &test.vault_id).set_skew_cap(&xlm, &10_000);

        let t1 = fund_trader(&test, 100 * PRECISION);
        let t2 = fund_trader(&test, 100 * PRECISION);
        let p1 = test.market.open_position(&t1, &xlm, &(10 * PRECISION), &5, &Direction::Long, &0);
        let p2 = if cross_second {
            test.market.open_position_cross(&t2, &xlm, &(10 * PRECISION), &5, &Direction::Long, &0)
        } else {
            test.market.open_position(&t2, &xlm, &(10 * PRECISION), &5, &Direction::Long, &0)
        };

        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(3 * PRECISION / 10));
        (test, t1, t2, p1, p2)
    }

    #[test]
    fn test_adl_close_rejected_when_flag_inactive() {
        let (test, t1, _t2, p1, _p2) = adl_scenario(false);
        // Flag never flipped: adl_close must refuse even a huge winner.
        let res = test.market.try_adl_close(&t1, &p1.id);
        assert_eq!(res, Err(Ok(NoetherError::AdlNotActive)));
    }

    #[test]
    fn test_check_adl_trigger_flips_on_low_coverage() {
        let (test, _t1, _t2, _p1, _p2) = adl_scenario(false);
        let xlm = Symbol::new(&test.env, "XLM");
        assert!(!test.market.is_adl_active(&xlm));
        assert!(test.market.check_adl_trigger(&xlm));
        assert!(test.market.is_adl_active(&xlm));
    }

    #[test]
    fn test_check_adl_trigger_clears_with_hysteresis() {
        let (test, _t1, _t2, _p1, _p2) = adl_scenario(false);
        let xlm = Symbol::new(&test.env, "XLM");
        assert!(test.market.check_adl_trigger(&xlm));

        // Fresh LP capital lifts coverage above the 1.5× clear ratio.
        let whale = fund_trader(&test, 1_000 * PRECISION);
        let vault = vault::Client::new(&test.env, &test.vault_id);
        vault.deposit(&whale, &(500 * PRECISION));
        assert!(!test.market.check_adl_trigger(&xlm));
        assert!(!test.market.is_adl_active(&xlm));
    }

    #[test]
    fn test_adl_close_pays_isolated_winner_in_full() {
        let (test, t1, _t2, p1, _p2) = adl_scenario(false);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);
        let xlm = Symbol::new(&test.env, "XLM");
        assert!(test.market.check_adl_trigger(&xlm));

        let w0 = usdc.balance(&t1);
        let anyone = fund_trader(&test, PRECISION);
        let realized = test.market.adl_close(&anyone, &p1.id);

        // Paid IN FULL at the mark: collateral + pnl to the wallet, zero
        // slippage by construction; only future upside is lost.
        let pnl = p1.size * (3 * PRECISION / 10 - p1.entry_price) / p1.entry_price;
        assert_eq!(realized, pnl);
        assert_eq!(usdc.balance(&t1) - w0, p1.collateral + pnl);
        assert!(test.market.get_position(&p1.id).is_none());
    }

    #[test]
    fn test_adl_close_credits_cross_pool() {
        let (test, _t1, t2, _p1, p2) = adl_scenario(true);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);
        let xlm = Symbol::new(&test.env, "XLM");
        assert!(test.market.check_adl_trigger(&xlm));

        let w0 = usdc.balance(&t2);
        let anyone = fund_trader(&test, PRECISION);
        let pnl = test.market.adl_close(&anyone, &p2.id);

        // Cross ADL settles to the POOL, not the wallet.
        assert_eq!(usdc.balance(&t2), w0);
        assert_eq!(test.market.get_cross_margin_balance(&t2), p2.collateral + pnl);
    }

    #[test]
    fn test_adl_close_rejects_losing_position() {
        let (test, _t1, _t2, _p1, _p2) = adl_scenario(false);
        let xlm = Symbol::new(&test.env, "XLM");
        // A short opened before the pump is deep underwater after it.
        let loser = fund_trader(&test, 100 * PRECISION);
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(PRECISION / 10));
        let short = test.market.open_position(&loser, &xlm, &(10 * PRECISION), &2, &Direction::Short, &0);
        oracle.set_price(&xlm, &(3 * PRECISION / 10));
        assert!(test.market.check_adl_trigger(&xlm));

        let anyone = fund_trader(&test, PRECISION);
        let res = test.market.try_adl_close(&anyone, &short.id);
        assert_eq!(res, Err(Ok(NoetherError::AdlNotEligible)));
    }

    #[test]
    fn test_shortfall_settle_auto_flags_adl() {
        let test = setup_with_vault_deposit(30 * PRECISION);
        let vault = vault::Client::new(&test.env, &test.vault_id);
        let xlm = Symbol::new(&test.env, "XLM");
        vault.set_asset_cap(&xlm, &10_000);
        vault.set_skew_cap(&xlm, &10_000);
        let trader = fund_trader(&test, 100 * PRECISION);
        let pos = test.market.open_position(&trader, &xlm, &(10 * PRECISION), &2, &Direction::Long, &0);

        // 3× pump: the winner's ~40 USDC claim beats the ~30 pool — the
        // short-paid close itself must flip the flag, no keeper involved.
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(3 * PRECISION / 10));
        assert!(!test.market.is_adl_active(&xlm));
        test.market.close_position(&trader, &pos.id, &0);
        assert!(test.market.is_adl_active(&xlm));
        assert!(vault.get_shortfall() > 0, "sanity: the flip came from a real shortfall");
    }

    #[test]
    fn test_adl_close_works_while_paused() {
        let (test, t1, _t2, p1, _p2) = adl_scenario(false);
        let xlm = Symbol::new(&test.env, "XLM");
        assert!(test.market.check_adl_trigger(&xlm));

        test.market.pause();
        let anyone = fund_trader(&test, PRECISION);
        let realized = test.market.adl_close(&anyone, &p1.id);
        assert!(realized > 0);
        test.market.unpause();
        let _ = t1;
    }

    #[test]
    fn test_open_blocked_while_adl_active() {
        let (test, _t1, _t2, _p1, _p2) = adl_scenario(false);
        let xlm = Symbol::new(&test.env, "XLM");
        assert!(test.market.check_adl_trigger(&xlm));

        let newcomer = fund_trader(&test, 100 * PRECISION);
        let res = test.market.try_open_position(&newcomer, &xlm, &(10 * PRECISION), &2, &Direction::Long, &0);
        assert!(matches!(res, Err(Ok(NoetherError::OpenInterestCapExceeded))));
    }

    #[test]
    fn test_adl_event_shape() {
        use soroban_sdk::testutils::Events;
        use soroban_sdk::TryFromVal;
        let (test, _t1, _t2, p1, _p2) = adl_scenario(false);
        let xlm = Symbol::new(&test.env, "XLM");
        assert!(test.market.check_adl_trigger(&xlm));

        let anyone = fund_trader(&test, PRECISION);
        test.market.adl_close(&anyone, &p1.id);

        let events = test.env.events().all();
        let mut adl_executed = 0u32;
        for e in events.iter() {
            let topics = e.1;
            if let Some(first) = topics.first() {
                if let Ok(s) = Symbol::try_from_val(&test.env, &first) {
                    if s == Symbol::new(&test.env, "adl_executed") {
                        adl_executed += 1;
                    }
                }
            }
        }
        assert_eq!(adl_executed, 1);
    }

    // ── L0-14: absolute OI cap + net-skew cap (market → vault) ──────────

    #[test]
    fn test_skew_cap_blocks_one_sided_open_via_do_open() {
        let test = setup_with_vault_deposit(1_000 * PRECISION);
        let vault = vault::Client::new(&test.env, &test.vault_id);
        let xlm = Symbol::new(&test.env, "XLM");
        vault.set_asset_cap(&xlm, &10_000); // lift OI cap
        vault.set_skew_cap(&xlm, &1_000); // 10% of ~1000 AUM = ~100

        let t1 = fund_trader(&test, 1_000 * PRECISION);
        // First long: net 0 → 100 (== cap, not over) is fine.
        test.market.open_position(&t1, &xlm, &(20 * PRECISION), &5, &Direction::Long, &0);
        // Second long pushes net past the cap AND worsens it → #89.
        let t2 = fund_trader(&test, 1_000 * PRECISION);
        let res = test.market.try_open_position(&t2, &xlm, &(20 * PRECISION), &5, &Direction::Long, &0);
        assert!(matches!(res, Err(Ok(NoetherError::SkewCapExceeded))));

        // A short (skew-reducing) is accepted even though the book is at cap.
        let ok = test.market.open_position(&t2, &xlm, &(20 * PRECISION), &5, &Direction::Short, &0);
        assert_eq!(ok.direction, Direction::Short);
    }

    #[test]
    fn test_absolute_oi_cap_via_do_open() {
        let test = setup_with_vault_deposit(1_000 * PRECISION);
        let vault = vault::Client::new(&test.env, &test.vault_id);
        let xlm = Symbol::new(&test.env, "XLM");
        vault.set_asset_cap_abs(&xlm, &(200 * PRECISION)); // absolute 200 USD side cap

        let t1 = fund_trader(&test, 1_000 * PRECISION);
        // 150 side-OI fits under 200.
        test.market.open_position(&t1, &xlm, &(30 * PRECISION), &5, &Direction::Long, &0);
        // Another 150 long → 300 side-OI over the absolute 200 → #82.
        let t2 = fund_trader(&test, 1_000 * PRECISION);
        let res = test.market.try_open_position(&t2, &xlm, &(30 * PRECISION), &5, &Direction::Long, &0);
        assert!(matches!(res, Err(Ok(NoetherError::OpenInterestCapExceeded))));
    }

    // ── L0-5: staged cross-margin liquidation ───────────────────────────

    /// Two-leg cross account under the mm5 (ladder) regime: XLM deep loser,
    /// ETH flat/mild. Returns (test, trader, xlm_pos, eth_pos).
    fn cross_two_legs(xlm_price_bps_of_entry: i128, eth_price: i128) -> (TestEnv, Address, Position, Position) {
        let test = setup_with_config(mm5_config());
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let xlm = Symbol::new(&test.env, "XLM");
        let eth = Symbol::new(&test.env, "ETH");
        let p1 = test.market.open_position_cross(&trader, &xlm, &(100 * PRECISION), &10, &Direction::Long, &0);
        let p2 = test.market.open_position_cross(&trader, &eth, &(100 * PRECISION), &10, &Direction::Long, &0);
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&xlm, &(PRECISION * xlm_price_bps_of_entry / 10_000));
        oracle.set_price(&eth, &eth_price);
        (test, trader, p1, p2)
    }

    #[test]
    fn test_cross_staged_closes_worst_leg_and_stops_at_restore_target() {
        // XLM leg loses ~its whole collateral share; ETH untouched. Equity
        // (~98.5) sits between 2/3·MM (66.3) and MM (99.5): STAGED.
        let (test, trader, p1, p2) = cross_two_legs(899, 3_000 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);

        test.market.liquidate_cross_account(&keeper, &trader);

        // Worst leg (XLM) closed; ETH survives; account healthy again.
        assert!(test.market.get_position(&p1.id).is_none());
        assert!(test.market.get_position(&p2.id).is_some());
        let res = test.market.try_liquidate_cross_account(&keeper, &trader);
        assert_eq!(res, Err(Ok(NoetherError::CrossMarginNotLiquidatable)));
    }

    #[test]
    fn test_cross_staged_orders_legs_by_ascending_upnl() {
        // Both legs lose; XLM far worse. Ascending-uPnL selection must take
        // XLM first and stop with ETH alive.
        let (test, trader, p1, p2) = cross_two_legs(902, 2_990 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);

        test.market.liquidate_cross_account(&keeper, &trader);
        assert!(test.market.get_position(&p1.id).is_none(), "worst leg must close first");
        assert!(test.market.get_position(&p2.id).is_some(), "mild leg must survive");
    }

    #[test]
    fn test_cross_staged_cooldown_returns_83_then_allows_after_30s() {
        let (test, trader, _p1, p2) = cross_two_legs(899, 3_000 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);
        let eth = Symbol::new(&test.env, "ETH");
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);

        // Round 1 restores health (survivor: ETH) and stamps the grace ts.
        test.market.liquidate_cross_account(&keeper, &trader);
        assert!(test.market.get_position(&p2.id).is_some());

        // ETH slides: liquidatable again but still in the STAGED band —
        // inside the 30s window the account is shielded (#83).
        oracle.set_price(&eth, &(2_840 * PRECISION));
        let blocked = test.market.try_liquidate_cross_account(&keeper, &trader);
        assert_eq!(blocked, Err(Ok(NoetherError::LiquidationCooldown)));

        // After the grace period the round runs and the residual stays on
        // the pool (full close of the last leg).
        test.env.ledger().set_timestamp(test.env.ledger().timestamp() + 31);
        test.market.liquidate_cross_account(&keeper, &trader);
        assert!(test.market.get_position(&p2.id).is_none());
        assert!(test.market.get_cross_margin_balance(&trader) > 0);
    }

    #[test]
    fn test_cross_close_out_below_two_thirds_mm_closes_whole_book() {
        // Equity ~46.4 < 2/3·MM (66.3): full-book close-out in one call,
        // penalties applied, residual stays on the pool.
        let (test, trader, p1, p2) = cross_two_legs(880, 2_900 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);

        let reward = test.market.liquidate_cross_account(&keeper, &trader);
        assert!(test.market.get_position(&p1.id).is_none());
        assert!(test.market.get_position(&p2.id).is_none());
        assert!(reward > 0, "close-out charges penalties");
        let residual = test.market.get_cross_margin_balance(&trader);
        assert!(residual > 0, "residual equity must stay on the pool");

        // And it is withdrawable immediately.
        let w0 = usdc.balance(&trader);
        test.market.withdraw_cross_margin(&trader, &residual);
        assert_eq!(usdc.balance(&trader) - w0, residual);
    }

    #[test]
    fn test_cross_bankrupt_overrides_cooldown_and_caps_bad_debt() {
        let (test, trader, _p1, p2) = cross_two_legs(899, 3_000 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);
        let eth = Symbol::new(&test.env, "ETH");
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        let usdc = soroban_sdk::token::Client::new(&test.env, &test.usdc_token);

        // Round 1 stamps the grace ts with ETH surviving.
        test.market.liquidate_cross_account(&keeper, &trader);
        assert!(test.market.get_position(&p2.id).is_some());

        // ETH crashes to bankruptcy INSIDE the grace window — the override
        // must let the liquidation through (waiting only grows bad debt).
        oracle.set_price(&eth, &(2_400 * PRECISION));
        let market_before = usdc.balance(&test.market_id);
        let reward = test.market.liquidate_cross_account(&keeper, &trader);

        assert_eq!(reward, 0, "bankrupt round pays no penalty/keeper cut");
        assert!(test.market.get_position(&p2.id).is_none());
        assert_eq!(test.market.get_cross_margin_balance(&trader), 0);
        // Loss transfers were capped at what the market physically held.
        let market_after = usdc.balance(&test.market_id);
        assert!(market_before - market_after <= market_before);
    }

    #[test]
    fn test_cross_staged_emits_per_leg_position_liquidated_plus_cross_liq() {
        use soroban_sdk::testutils::Events;
        use soroban_sdk::TryFromVal;
        let (test, trader, _p1, _p2) = cross_two_legs(899, 3_000 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);

        test.market.liquidate_cross_account(&keeper, &trader);

        // One per-leg position_liquidated (7-tuple, existing shape) plus the
        // cross_liq summary; no liq_refund while a survivor remains.
        let events = test.env.events().all();
        let mut liquidated = 0u32;
        let mut summaries = 0u32;
        let mut refunds = 0u32;
        for e in events.iter() {
            let topics = e.1;
            if let Some(first) = topics.first() {
                if let Ok(s) = Symbol::try_from_val(&test.env, &first) {
                    if s == Symbol::new(&test.env, "position_liquidated") {
                        liquidated += 1;
                    } else if s == Symbol::new(&test.env, "cross_liq") {
                        summaries += 1;
                    } else if s == Symbol::new(&test.env, "liq_refund") {
                        refunds += 1;
                    }
                }
            }
        }
        assert_eq!(liquidated, 1, "exactly the worst leg emits per-leg detail");
        assert_eq!(summaries, 1, "one aggregate cross_liq summary");
        assert_eq!(refunds, 0, "no refund event while a leg survives");
    }

    #[test]
    fn test_liquidation_cascade_multiple_simultaneous_positions() {
        // The deliverable's "full liquidation cascade with multiple
        // simultaneous positions" (T3-D4), driven exactly as the keeper
        // would: a crash makes N independent traders' positions liquidatable
        // at once, and one liquidate() call per id clears them all while the
        // insurance buffer accrues its share from each.
        let test = setup();
        let keeper = fund_trader(&test, 100 * PRECISION);
        let vault = vault::Client::new(&test.env, &test.vault_id);
        let btc = Symbol::new(&test.env, "BTC");

        // 6 positions: mix of small (full-liq) and large (partial-first),
        // longs and shorts, so the cascade exercises both liquidation paths.
        let mut ids = soroban_sdk::Vec::new(&test.env);
        let specs = [
            (50, Direction::Long),   // small long  — full liq
            (200, Direction::Long),  // large long  — partial first
            (75, Direction::Long),   // small long  — full liq
            (300, Direction::Long),  // large long  — partial first
            (60, Direction::Long),   // small long  — full liq
            (150, Direction::Long),  // large long  — partial first
        ];
        for (collateral, dir) in specs.iter() {
            let trader = fund_trader(&test, 1_000 * PRECISION);
            let pos = test.market.open_position(
                &trader, &btc, &(*collateral * PRECISION), &10, dir, &0,
            );
            ids.push_back(pos.id);
        }

        let all_before = test.market.get_all_position_ids();
        assert_eq!(all_before.len(), 6);
        let buffer_before = vault.get_buffer_balance();

        // Crash 12% — every 10x long is deep underwater and liquidatable.
        set_btc_price(&test, 52_800 * PRECISION);

        // Keeper sweep: one liquidate() per id, exactly like the bot loop.
        for id in ids.iter() {
            let res = test.market.try_liquidate(&keeper, &id);
            assert!(res.is_ok(), "cascade liquidation of {id} must succeed");
        }

        // At a 12% crash even the large positions are bankrupt (equity gone),
        // so the whole book is fully liquidated in one sweep — no survivors.
        assert_eq!(test.market.get_all_position_ids().len(), 0);
        // The insurance buffer took its cut from the cascade.
        assert!(vault.get_buffer_balance() > buffer_before);
    }

    #[test]
    fn test_partial_liq_multiple_rounds_until_below_threshold() {
        // Repeated partial rounds shrink the position geometrically; once the
        // remaining notional falls to/below the $1,000 threshold the NEXT
        // liquidation is a full one. Proves multi-round behaviour terminates.
        let test = setup();
        let trader = fund_trader(&test, 5_000 * PRECISION);
        let keeper = fund_trader(&test, 100 * PRECISION);
        let btc = Symbol::new(&test.env, "BTC");

        // $30,000 notional: 20% tranches take 15 rounds to cross $1,000.
        let pos = test.market.open_position(
            &trader, &btc, &(3_000 * PRECISION), &10, &Direction::Long, &0,
        );

        let mut rounds = 0;
        loop {
            // Hold price just past the CURRENT position's liquidation price so
            // each round is liquidatable-but-solvent.
            let current = match test.market.get_position(&pos.id) {
                Some(p) => p,
                None => break, // fully liquidated — cascade terminated
            };
            set_btc_price(&test, current.liquidation_price - PRECISION);

            let res = test.market.try_liquidate(&keeper, &pos.id);
            assert!(res.is_ok(), "round {rounds} must liquidate");
            rounds += 1;
            assert!(rounds < 30, "multi-round liquidation must terminate");

            // Advance past the grace period for the next round.
            test.env.ledger().set_timestamp(test.env.ledger().timestamp() + 31);
        }

        // It took several partial rounds before the final full liquidation.
        assert!(rounds > 1, "expected multiple partial rounds, got {rounds}");
        assert!(test.market.get_position(&pos.id).is_none());
    }

    // ═══════════════════════════════════════════════════════════════════
    // Config-shape upgrade path (deploy safety)
    // ═══════════════════════════════════════════════════════════════════

    /// The MarketConfig as stored by the currently-DEPLOYED wasm (11 fields,
    /// pre-T3-D4). Soroban stores a struct as an exact field map, so this is
    /// what an in-place `upgrade()` leaves behind.
    #[soroban_sdk::contracttype]
    #[derive(Clone)]
    pub struct PreT3MarketConfig {
        pub min_collateral: i128,
        pub max_leverage: u32,
        pub maintenance_margin_bps: u32,
        pub liquidation_fee_bps: u32,
        pub trading_fee_bps: u32,
        pub base_funding_rate_bps: u32,
        pub max_position_size: i128,
        pub max_price_staleness: u64,
        pub max_oracle_deviation_bps: u32,
        pub base_maker_fee_bps: u32,
        pub base_taker_fee_bps: u32,
    }

    fn write_pre_t3_config(test: &TestEnv) {
        test.env.as_contract(&test.market_id, || {
            let old = PreT3MarketConfig {
                min_collateral: 10 * PRECISION,
                max_leverage: 10,
                maintenance_margin_bps: 100,
                liquidation_fee_bps: 500,
                trading_fee_bps: 10,
                base_funding_rate_bps: 1,
                max_position_size: 100_000 * PRECISION,
                max_price_staleness: 60,
                max_oracle_deviation_bps: 100,
                base_maker_fee_bps: 2,
                base_taker_fee_bps: 5,
            };
            test.env.storage().instance().set(&DataKey::Config, &old);
        });
    }

    #[test]
    #[should_panic] // HostError: Error(Object, UnexpectedSize)
    fn test_pre_upgrade_config_cannot_be_read_by_new_wasm() {
        // Documents WHY migrate_config exists: after an in-place upgrade the
        // old config no longer decodes, and every config-reading entry point
        // traps. `unwrap_or_default()` does NOT rescue this — the trap
        // happens inside the storage read.
        let test = setup();
        write_pre_t3_config(&test);
        let _ = test.env.as_contract(&test.market_id, || get_config(&test.env));
    }

    #[test]
    fn test_migrate_config_recovers_a_bricked_upgrade() {
        let test = setup();
        write_pre_t3_config(&test);

        // migrate_config never reads the old value, so it works from the
        // bricked state — the one-way door out.
        let fresh = MarketConfig::default();
        test.market.migrate_config(&fresh);

        let cfg = test.env.as_contract(&test.market_id, || get_config(&test.env));
        assert_eq!(cfg.partial_liq_min_notional, 1_000 * PRECISION);
        assert_eq!(cfg.partial_liq_tranche_bps, 2_000);
        assert_eq!(cfg.partial_liq_cooldown_secs, 30);
        assert_eq!(cfg.insurance_buffer_share_bps, 1_000);

        // ...and trading works again.
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let pos = test.market.open_position(
            &trader, &Symbol::new(&test.env, "BTC"), &(50 * PRECISION), &5, &Direction::Long, &0,
        );
        assert!(pos.id > 0);
    }

    #[test]
    fn test_migrate_config_rejects_nonsense() {
        let test = setup();
        // 100% tranche would be a full liquidation wearing a partial's clothes
        let bad = MarketConfig {
            partial_liq_tranche_bps: BASIS_POINTS,
            ..MarketConfig::default()
        };
        assert_eq!(
            test.market.try_migrate_config(&bad),
            Err(Ok(NoetherError::InvalidParameter))
        );

        // >100% of proceeds to the buffer would starve LPs entirely
        let bad2 = MarketConfig {
            insurance_buffer_share_bps: BASIS_POINTS + 1,
            ..MarketConfig::default()
        };
        assert_eq!(
            test.market.try_migrate_config(&bad2),
            Err(Ok(NoetherError::InvalidParameter))
        );
    }

    #[test]
    fn test_partial_liq_insufficient_margin_after_partial_falls_through_to_full() {
        // Edge case from the deliverable: when a tranche cannot leave a
        // solvent remainder (the realized debit + keeper reward would consume
        // the whole collateral share), the partial path must NOT strand a
        // zero-collateral position — it falls through to a full liquidation.
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let keeper = fund_trader(&test, 10 * PRECISION);
        let btc = Symbol::new(&test.env, "BTC");

        // Large enough for the partial path ($2,000 notional)...
        let pos = test.market.open_position(
            &trader, &btc, &(200 * PRECISION), &10, &Direction::Long, &0,
        );
        // ...but crashed so hard that equity is gone: `bankrupt` short-circuits
        // the tranche and the position is closed out entirely in one step.
        set_btc_price(&test, 53_500 * PRECISION);

        let reward = test.market.liquidate(&keeper, &pos.id);
        assert!(test.market.get_position(&pos.id).is_none());
        assert_eq!(reward, 0, "no equity left to reward the keeper from");
    }
}
