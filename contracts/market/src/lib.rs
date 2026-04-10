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

use soroban_sdk::{contract, contractimpl, token, Address, Env, Symbol, Vec, IntoVal};
use noether_common::{
    NoetherError, Position, Direction, MarketConfig, MarketStats,
    Order, OrderType, OrderStatus, TriggerCondition, KeeperFeeConfig,
    FeeTier, TraderFeeInfo, VolumeRecord, PRECISION, BASIS_POINTS,
    calculate_position_size, calculate_liquidation_price, calculate_pnl,
    calculate_trading_fee, calculate_funding_rate, calculate_cumulative_funding,
    calculate_keeper_reward, should_liquidate,
};

mod storage;
mod position;
mod trading;
mod liquidation;
mod funding;

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
    if fee_tiers.len() > 0 {
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

/// Record only volume (no fee calculation). Used for close operations.
fn record_volume_only(env: &Env, trader: &Address, size: i128) {
    let fee_tiers = get_fee_tiers(env);
    if fee_tiers.len() > 0 {
        let mut volume_record = get_trader_volume(env, trader)
            .unwrap_or(VolumeRecord {
                daily_volumes: Vec::new(env),
                last_update_day: 0,
            });
        let current_day = trading::timestamp_to_day(env.ledger().timestamp());
        trading::record_trade_volume(env, &mut volume_record, size, current_day);
        set_trader_volume(env, trader, &volume_record);
    }
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
    ) -> Result<Position, NoetherError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;

        trader.require_auth();

        let config = get_config(&env);

        // Validate parameters
        if collateral < config.min_collateral {
            return Err(NoetherError::InsufficientCollateral);
        }
        if leverage < 1 || leverage > config.max_leverage {
            return Err(NoetherError::InvalidLeverage);
        }

        // Calculate position size
        let size = calculate_position_size(collateral, leverage);
        if size > config.max_position_size {
            return Err(NoetherError::PositionTooLarge);
        }

        // Check Vault has enough liquidity for potential payout
        // Maximum potential payout is the position size (100% gain)
        let vault_address = get_vault(&env);
        Self::check_vault_liquidity(&env, &vault_address, size)?;

        // Fetch current price
        let entry_price = Self::get_oracle_price(&env, &asset)?;

        // Calculate liquidation price
        let liquidation_price = calculate_liquidation_price(
            entry_price,
            leverage,
            direction.clone(),
            config.maintenance_margin_bps,
        );

        // Calculate taker fee and record volume
        let fee = calculate_fee_and_record_volume(&env, &trader, size, false, &config);
        let net_collateral = collateral - fee;
        if net_collateral <= 0 {
            return Err(NoetherError::InsufficientCollateral);
        }

        // Transfer collateral from trader to market contract
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&trader, &env.current_contract_address(), &collateral);

        // Generate position ID
        let position_id = next_position_id(&env);

        // Create position (isolated margin mode)
        let position = Position {
            id: position_id,
            trader: trader.clone(),
            asset: asset.clone(),
            collateral: net_collateral,
            size,
            entry_price,
            direction: direction.clone(),
            leverage,
            liquidation_price,
            timestamp: env.ledger().timestamp(),
            entry_cumulative_funding: get_cumulative_funding_rate(&env),
            margin_mode: 0, // Isolated
        };

        // Store position
        save_position(&env, &position);

        // Update market stats
        match direction {
            Direction::Long => {
                let total = get_total_long_size(&env);
                set_total_long_size(&env, total + size);
            }
            Direction::Short => {
                let total = get_total_short_size(&env);
                set_total_short_size(&env, total + size);
            }
        }

        // Transfer fee to vault
        token_client.transfer(&env.current_contract_address(), &vault_address, &fee);

        // Emit event
        env.events().publish(
            (Symbol::new(&env, "position_opened"),),
            (position.id, trader, asset, direction, size, entry_price),
        );

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

        // Calculate funding from cumulative rate
        let cumulative = get_cumulative_funding_rate(&env);
        let funding = calculate_cumulative_funding(
            position.size, position.direction.clone(),
            position.entry_cumulative_funding, cumulative,
        );

        // Get current price
        let current_price = Self::get_oracle_price(&env, &position.asset)?;

        // Calculate PnL
        let pnl = calculate_pnl(&position, current_price)?;

        // Calculate amount to return to trader
        let to_trader = position.collateral + pnl - funding;

        // Settle with vault
        let vault_address = get_vault(&env);
        Self::settle_with_vault(&env, &vault_address, pnl)?;

        // Get token client for transfers
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);

        // If trader lost, transfer the loss amount to Vault
        if pnl < 0 {
            let loss = -pnl;
            token_client.transfer(&env.current_contract_address(), &vault_address, &loss);
        }

        // Transfer funding to vault (if trader owes funding)
        if funding > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &vault_address,
                &funding,
            );
        }

        // Transfer to trader (if positive)
        if to_trader > 0 {
            token_client.transfer(&env.current_contract_address(), &trader, &to_trader);
        }

        // Update market stats
        match position.direction {
            Direction::Long => {
                let total = get_total_long_size(&env);
                set_total_long_size(&env, if total > position.size { total - position.size } else { 0 });
            }
            Direction::Short => {
                let total = get_total_short_size(&env);
                set_total_short_size(&env, if total > position.size { total - position.size } else { 0 });
            }
        }

        // Record volume for fee tier tracking
        record_volume_only(&env, &trader, position.size);

        // Delete position
        delete_position(&env, position_id, &trader);

        env.events().publish(
            (Symbol::new(&env, "position_closed"),),
            (position_id, trader, position.asset, position.direction, position.size, position.entry_price, current_price, pnl),
        );

        extend_instance_ttl(&env);

        Ok(pnl)
    }

    // add_collateral removed for WASM size - close and reopen with more collateral

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
        let current_price = Self::get_oracle_price(&env, &position.asset)?;

        // Check if liquidatable (includes pending funding in margin check)
        if !Self::should_liquidate_with_funding(&env, &position, current_price) {
            return Err(NoetherError::NotLiquidatable);
        }

        let config = get_config(&env);

        // Calculate PnL and funding
        let pnl = calculate_pnl(&position, current_price)?;
        let cumulative = get_cumulative_funding_rate(&env);
        let funding = calculate_cumulative_funding(
            position.size, position.direction.clone(),
            position.entry_cumulative_funding, cumulative,
        );

        // Calculate remaining collateral after PnL and funding
        let remaining = position.collateral + pnl - funding;

        // Calculate keeper reward (only from remaining equity, if positive)
        let keeper_reward = if remaining > 0 {
            calculate_keeper_reward(remaining, config.liquidation_fee_bps)
        } else {
            0
        };

        // Ensure keeper_reward doesn't exceed position collateral
        let actual_keeper_reward = if keeper_reward > position.collateral {
            position.collateral / 10 // Cap at 10% of collateral as safety
        } else {
            keeper_reward
        };

        // Calculate what goes to Vault (everything except keeper reward)
        let vault_receives = if position.collateral > actual_keeper_reward {
            position.collateral - actual_keeper_reward
        } else {
            0
        };

        // Get addresses and token client
        let vault_address = get_vault(&env);
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);

        // Settle with vault - pass the amount Vault is receiving (as negative pnl)
        // This ensures Vault's total_usdc accounting matches actual token receipt
        if vault_receives > 0 {
            Self::settle_with_vault(&env, &vault_address, -vault_receives)?;
            token_client.transfer(&env.current_contract_address(), &vault_address, &vault_receives);
        }

        // Pay keeper reward
        if actual_keeper_reward > 0 {
            token_client.transfer(&env.current_contract_address(), &keeper, &actual_keeper_reward);
        }

        // Update market stats
        match position.direction {
            Direction::Long => {
                let total = get_total_long_size(&env);
                set_total_long_size(&env, if total > position.size { total - position.size } else { 0 });
            }
            Direction::Short => {
                let total = get_total_short_size(&env);
                set_total_short_size(&env, if total > position.size { total - position.size } else { 0 });
            }
        }

        // Delete position
        delete_position(&env, position_id, &position.trader);

        env.events().publish(
            (Symbol::new(&env, "position_liquidated"),),
            (position_id, position.trader, position.asset, position.direction, position.size, actual_keeper_reward, current_price),
        );

        extend_instance_ttl(&env);

        Ok(actual_keeper_reward)
    }

    /// Check if a position can be liquidated (includes pending funding).
    /// Cross-margin positions (margin_mode=1) are never individually liquidatable —
    /// they use account-level liquidation via `liquidate_cross_account`.
    pub fn is_liquidatable(env: Env, position_id: u64) -> Result<bool, NoetherError> {
        let position = get_position(&env, position_id)
            .ok_or(NoetherError::PositionNotFound)?;

        // Cross-margin positions use account-level liquidation, not per-position
        if position.margin_mode == 1 {
            return Ok(false);
        }

        let current_price = Self::get_oracle_price(&env, &position.asset)?;

        Ok(Self::should_liquidate_with_funding(&env, &position, current_price))
    }

    // get_liquidatable_positions removed for WASM size - keeper checks each position individually

    // ═══════════════════════════════════════════════════════════════════════
    // Funding Rate Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Apply funding to all positions (can be called periodically).
    /// Funding balances long/short interest:
    /// - If more longs than shorts: longs pay shorts
    /// - If more shorts than longs: shorts pay longs
    pub fn apply_funding(env: Env) -> Result<(), NoetherError> {
        require_initialized(&env)?;

        let current_time = env.ledger().timestamp();
        let last_funding = get_last_funding_time(&env);

        // Require at least 1 hour between funding applications
        if current_time < last_funding + 3600 {
            return Err(NoetherError::FundingIntervalNotElapsed);
        }

        let hours_elapsed = (current_time - last_funding) / 3600;
        if hours_elapsed == 0 {
            return Ok(());
        }

        let config = get_config(&env);
        let total_long = get_total_long_size(&env);
        let total_short = get_total_short_size(&env);

        // Calculate funding rate
        let funding_rate = calculate_funding_rate(
            total_long,
            total_short,
            config.base_funding_rate_bps,
        );

        // Store current rate for reference
        set_current_funding_rate(&env, funding_rate);
        set_last_funding_time(&env, current_time);

        // Accumulate into cumulative rate (enables accurate per-position funding)
        let cumulative = get_cumulative_funding_rate(&env);
        let new_cumulative = cumulative + funding_rate * (hours_elapsed as i128);
        set_cumulative_funding_rate(&env, new_cumulative);

        env.events().publish(
            (Symbol::new(&env, "funding_applied"),),
            (funding_rate, hours_elapsed),
        );

        Ok(())
    }

    /// Get current funding rate.
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
                Self::get_oracle_price(&env, asset).unwrap_or(0)
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
    ) -> Result<Position, NoetherError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;
        trader.require_auth();

        let config = get_config(&env);

        if collateral < config.min_collateral {
            return Err(NoetherError::InsufficientCollateral);
        }
        if leverage < 1 || leverage > config.max_leverage {
            return Err(NoetherError::InvalidLeverage);
        }

        let size = calculate_position_size(collateral, leverage);
        if size > config.max_position_size {
            return Err(NoetherError::PositionTooLarge);
        }

        // Auto-deposit: if pool balance is insufficient, pull from wallet
        let pool_balance = get_cross_margin_balance(&env, &trader);
        if collateral > pool_balance {
            let shortfall = collateral - pool_balance;
            // Transfer shortfall from trader wallet to market contract
            let usdc_token = get_usdc_token(&env);
            let token_client = token::Client::new(&env, &usdc_token);
            token_client.transfer(&trader, &env.current_contract_address(), &shortfall);
            // Update pool balance (old balance + shortfall = collateral)
            let new_pool = pool_balance.checked_add(shortfall).ok_or(NoetherError::Overflow)?;
            set_cross_margin_balance(&env, &trader, new_pool);
            add_cross_margin_trader(&env, &trader);
        }

        // Now pool has enough - deduct collateral
        let updated_pool = get_cross_margin_balance(&env, &trader);

        // Free margin check (Binance-style): equity - used_margin must cover new position's initial margin.
        // This prevents opening new positions when the account is already near liquidation.
        let existing_cross_positions = get_cross_margin_position_ids(&env, &trader);
        if !existing_cross_positions.is_empty() {
            let get_price = |asset: &Symbol| -> i128 {
                Self::get_oracle_price(&env, asset).unwrap_or(0)
            };
            let equity = position::calculate_cross_equity(&env, &trader, &get_price);
            let mm = position::calculate_cross_maintenance_margin(
                &env, &trader, config.maintenance_margin_bps,
            );
            // Must have positive equity above maintenance margin + new collateral
            if equity < mm + collateral {
                return Err(NoetherError::CrossMarginInsufficientFreeMargin);
            }
        }

        // Check vault liquidity
        let vault_address = get_vault(&env);
        Self::check_vault_liquidity(&env, &vault_address, size)?;

        // Fetch price from oracle
        let entry_price = Self::get_oracle_price(&env, &asset)?;

        // Calculate taker fee and record volume
        let fee = calculate_fee_and_record_volume(&env, &trader, size, false, &config);

        let net_collateral = collateral - fee;
        if net_collateral <= 0 {
            return Err(NoetherError::InsufficientCollateral);
        }

        // Deduct collateral from pool
        let new_balance = updated_pool - collateral;
        set_cross_margin_balance(&env, &trader, new_balance);

        // Generate position ID
        let position_id = next_position_id(&env);

        // Create cross-margin position (liquidation_price = 0, account-level liquidation)
        let position = Position {
            id: position_id,
            trader: trader.clone(),
            asset: asset.clone(),
            collateral: net_collateral,
            size,
            entry_price,
            direction: direction.clone(),
            leverage,
            liquidation_price: 0, // Cross-margin: no per-position liq price
            timestamp: env.ledger().timestamp(),
            entry_cumulative_funding: get_cumulative_funding_rate(&env),
            margin_mode: 1, // Cross
        };

        // Store position in both regular and cross-margin indices
        save_position(&env, &position);
        add_cross_margin_position(&env, &trader, position_id);

        // Update market stats
        match direction {
            Direction::Long => {
                let total = get_total_long_size(&env);
                set_total_long_size(&env, total + size);
            }
            Direction::Short => {
                let total = get_total_short_size(&env);
                set_total_short_size(&env, total + size);
            }
        }

        // Transfer fee to vault
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&env.current_contract_address(), &vault_address, &fee);

        extend_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "position_opened"),),
            (position_id, trader, asset, direction, size, entry_price),
        );

        Ok(position)
    }

    /// Close a cross-margin position. PnL returns to cross-margin pool, not trader wallet.
    pub fn close_position_cross(
        env: Env,
        trader: Address,
        position_id: u64,
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

        // Calculate funding from cumulative rate
        let cumulative = get_cumulative_funding_rate(&env);
        let funding = calculate_cumulative_funding(
            pos.size, pos.direction.clone(),
            pos.entry_cumulative_funding, cumulative,
        );

        // Get current price and calculate PnL
        let current_price = Self::get_oracle_price(&env, &pos.asset)?;
        let pnl = calculate_pnl(&pos, current_price)?;

        // Settle with vault
        let vault_address = get_vault(&env);
        Self::settle_with_vault(&env, &vault_address, pnl)?;

        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);

        // Transfer loss to vault if needed
        if pnl < 0 {
            let loss = -pnl;
            token_client.transfer(&env.current_contract_address(), &vault_address, &loss);
        }

        // Transfer funding to vault if needed
        if funding > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &vault_address,
                &funding,
            );
        }

        // Return remaining equity to cross-margin pool (NOT trader wallet)
        let to_pool = pos.collateral.checked_add(pnl).unwrap_or(0)
            .checked_sub(funding).unwrap_or(0);
        if to_pool > 0 {
            let current_balance = get_cross_margin_balance(&env, &trader);
            let new_balance = current_balance.checked_add(to_pool).unwrap_or(current_balance);
            set_cross_margin_balance(&env, &trader, new_balance);
        }

        // Record volume
        record_volume_only(&env, &trader, pos.size);

        // Update market stats (saturating to prevent underflow)
        match pos.direction {
            Direction::Long => {
                let total = get_total_long_size(&env);
                set_total_long_size(&env, if total > pos.size { total - pos.size } else { 0 });
            }
            Direction::Short => {
                let total = get_total_short_size(&env);
                set_total_short_size(&env, if total > pos.size { total - pos.size } else { 0 });
            }
        }

        // Clean up
        remove_cross_margin_position(&env, &trader, position_id);
        delete_position(&env, position_id, &trader);

        extend_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "position_closed"),),
            (position_id, trader, pos.asset, pos.direction, pos.size, pos.entry_price, current_price, pnl),
        );

        Ok(pnl)
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
            Self::get_oracle_price(&env, asset).unwrap_or(i128::MAX / 2)
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

        // Calculate total remaining equity
        let balance = get_cross_margin_balance(&env, &trader);
        let equity = position::calculate_cross_equity(&env, &trader, &get_price);

        // Close all cross positions - settle PnL with vault
        // Note: Market contract holds the cross-margin deposit as USDC.
        // Total available = deposit amount (balance + collateral in positions).
        // Losses can exceed this with leverage, so cap transfers at available balance.
        let market_addr = env.current_contract_address();
        let mut total_loss_to_vault: i128 = 0;
        let mut total_pnl: i128 = 0;
        let cumulative = get_cumulative_funding_rate(&env);

        for i in 0..position_ids.len() {
            let pid = position_ids.get(i).unwrap();
            if let Some(pos) = get_position(&env, pid) {
                // Use actual oracle price for settlement; skip position if oracle fails
                let current_price = match Self::get_oracle_price(&env, &pos.asset) {
                    Ok(p) if p > 0 => p,
                    _ => continue, // Skip this position if oracle unavailable
                };
                let pnl = calculate_pnl(&pos, current_price).unwrap_or(0);
                total_pnl += pnl;

                // Calculate funding from cumulative rate
                let funding = calculate_cumulative_funding(
                    pos.size, pos.direction.clone(),
                    pos.entry_cumulative_funding, cumulative,
                );

                // Settle accounting with vault
                let _ = Self::settle_with_vault(&env, &vault_address, pnl);

                if pnl < 0 {
                    total_loss_to_vault += -pnl;
                }

                // Include funding owed to vault
                if funding > 0 {
                    total_loss_to_vault += funding;
                }

                // Update market stats (saturating to prevent underflow)
                match pos.direction {
                    Direction::Long => {
                        let total = get_total_long_size(&env);
                        set_total_long_size(&env, if total > pos.size { total - pos.size } else { 0 });
                    }
                    Direction::Short => {
                        let total = get_total_short_size(&env);
                        set_total_short_size(&env, if total > pos.size { total - pos.size } else { 0 });
                    }
                }

                // Delete position
                delete_position(&env, pid, &trader);
            }
        }

        // Transfer losses to vault - capped at market contract's actual USDC balance
        // (leveraged losses can exceed deposited collateral = bad debt absorbed by vault)
        let market_usdc_balance = token_client.balance(&market_addr);
        if total_loss_to_vault > 0 && market_usdc_balance > 0 {
            let actual_transfer = if total_loss_to_vault > market_usdc_balance {
                market_usdc_balance
            } else {
                total_loss_to_vault
            };
            token_client.transfer(&market_addr, &vault_address, &actual_transfer);
        }

        // Calculate keeper reward from remaining equity (if any)
        // After losses, remaining market balance is what we can distribute
        let remaining_balance = token_client.balance(&market_addr);
        let keeper_reward = if equity > 0 && remaining_balance > 0 {
            let reward = equity * (config.liquidation_fee_bps as i128) / (BASIS_POINTS as i128);
            let max_reward = balance / 10; // Cap at 10% of original deposit
            let capped = if reward > max_reward { max_reward } else { reward };
            // Can't pay more than what's actually available
            if capped > remaining_balance { remaining_balance } else { capped }
        } else {
            0
        };

        // Pay keeper
        if keeper_reward > 0 {
            token_client.transfer(&market_addr, &keeper, &keeper_reward);
        }

        // Send remaining trader equity to vault (not other traders' deposits)
        // Trader's total deposit = pool balance + sum of position collaterals
        // We already know `balance` (pool balance before liquidation)
        // After settlements, at most `balance` worth of trader funds remain in contract
        if equity > keeper_reward {
            let to_vault = equity - keeper_reward;
            // Cap at what the trader actually deposited (balance = pool balance)
            let max_to_vault = if balance > keeper_reward { balance - keeper_reward } else { 0 };
            let actual_to_vault = if to_vault > max_to_vault { max_to_vault } else { to_vault };
            let market_balance = token_client.balance(&market_addr);
            let final_transfer = if actual_to_vault > market_balance { market_balance } else { actual_to_vault };
            if final_transfer > 0 {
                token_client.transfer(&market_addr, &vault_address, &final_transfer);
            }
        }

        // Clear cross-margin state
        set_cross_margin_balance(&env, &trader, 0);
        // Clear position list
        let empty_ids: Vec<u64> = Vec::new(&env);
        env.storage().persistent().set(
            &storage::DataKey::CrossMarginPositions(trader.clone()),
            &empty_ids,
        );
        remove_cross_margin_trader(&env, &trader);

        extend_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "cross_liq"),),
            (trader, total_pnl, keeper_reward),
        );

        Ok(keeper_reward)
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
        if leverage < 1 || leverage > config.max_leverage {
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
        if size > config.max_position_size {
            return Err(NoetherError::PositionTooLarge);
        }

        let trigger_condition = if trigger_above {
            TriggerCondition::Above
        } else {
            TriggerCondition::Below
        };

        // Post Only (tif_mode == 2): reject if trigger condition is already met
        if tif_mode == 2 {
            let current_price = Self::get_oracle_price(&env, &asset)?;
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
            let current_price = Self::get_oracle_price(&env, &asset)?;
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
            direction: position.direction.clone(),
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
            direction: position.direction.clone(),
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

        // Get current price
        let current_price = Self::get_oracle_price(&env, &order.asset)?;

        // Determine reference price for trigger/slippage check
        // TakeProfit with limit_price > 0 acts as "Take Limit": trigger at trigger_price,
        // but slippage is checked against limit_price (the desired exit price)
        let ref_price = match order.order_type {
            OrderType::StopLimit if order.stop_limit_phase == 1 => order.limit_price,
            OrderType::TakeProfit if order.limit_price > 0 => order.limit_price,
            OrderType::TrailingStop => {
                // Calculate dynamic trigger from peak
                if let Some(peak) = get_trailing_stop_peak(&env, order_id) {
                    match order.direction {
                        Direction::Long => peak - peak * (order.trailing_percent_bps as i128) / 10000,
                        Direction::Short => peak + peak * (order.trailing_percent_bps as i128) / 10000,
                    }
                } else {
                    order.trigger_price
                }
            }
            _ => order.trigger_price,
        };

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

    /// Check if an order should be executed at current price.
    pub fn should_execute_order(env: Env, order_id: u64) -> Result<bool, NoetherError> {
        let order = get_order(&env, order_id)
            .ok_or(NoetherError::OrderNotFound)?;

        if order.status != OrderStatus::Pending {
            return Ok(false);
        }

        let current_price = Self::get_oracle_price(&env, &order.asset)?;

        match order.order_type {
            OrderType::TrailingStop => {
                // Check if price has dropped trailing_percent from peak
                if let Some(peak) = get_trailing_stop_peak(&env, order_id) {
                    let trigger = match order.direction {
                        Direction::Long => {
                            // Trigger when price drops below peak * (1 - trailing%)
                            let threshold = peak - peak * (order.trailing_percent_bps as i128) / 10000;
                            current_price <= threshold
                        }
                        Direction::Short => {
                            // Trigger when price rises above peak * (1 + trailing%)
                            let threshold = peak + peak * (order.trailing_percent_bps as i128) / 10000;
                            current_price >= threshold
                        }
                    };
                    Ok(trigger)
                } else {
                    Ok(false)
                }
            }
            OrderType::StopLimit => {
                if order.stop_limit_phase == 0 {
                    // Phase 0: check if stop price is hit
                    let stop_triggered = match order.trigger_condition {
                        TriggerCondition::Above => current_price >= order.trigger_price,
                        TriggerCondition::Below => current_price <= order.trigger_price,
                    };
                    Ok(stop_triggered)
                } else {
                    // Phase 1: check if limit price is reached
                    let limit_triggered = match order.trigger_condition {
                        TriggerCondition::Above => current_price >= order.limit_price,
                        TriggerCondition::Below => current_price <= order.limit_price,
                    };
                    Ok(limit_triggered)
                }
            }
            _ => {
                // Standard trigger check for LimitEntry, StopLoss, TakeProfit
                let triggered = match order.trigger_condition {
                    TriggerCondition::Above => current_price >= order.trigger_price,
                    TriggerCondition::Below => current_price <= order.trigger_price,
                };
                Ok(triggered)
            }
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
        if leverage < 1 || leverage > config.max_leverage {
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
        if size > config.max_position_size {
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

        // Get current price as initial peak
        let current_price = Self::get_oracle_price(&env, &position.asset)?;

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
            direction: position.direction.clone(),
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

        let current_price = Self::get_oracle_price(&env, &order.asset)?;

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
        let cumulative = get_cumulative_funding_rate(env);
        let funding = calculate_cumulative_funding(
            pos.size, pos.direction.clone(),
            pos.entry_cumulative_funding, cumulative,
        );
        let margin = pos.collateral + pnl - funding;
        let config = get_config(env);
        margin < pos.size * (config.maintenance_margin_bps as i128) / (BASIS_POINTS as i128)
    }

    /// Fetch price from oracle adapter.
    fn get_oracle_price(env: &Env, asset: &Symbol) -> Result<i128, NoetherError> {
        let oracle_address = get_oracle_adapter(env);

        // Call oracle adapter using invoke_contract
        let args: Vec<soroban_sdk::Val> = (asset.clone(),).into_val(env);
        let (price, timestamp): (i128, u64) = env.invoke_contract(
            &oracle_address,
            &Symbol::new(env, "lastprice"),
            args,
        );

        // Check staleness
        let config = get_config(env);
        let current_time = env.ledger().timestamp();

        if current_time > timestamp && current_time - timestamp > config.max_price_staleness {
            return Err(NoetherError::PriceStale);
        }

        if price <= 0 {
            return Err(NoetherError::InvalidPrice);
        }

        Ok(price)
    }

    /// Check if Vault has enough liquidity for a potential payout.
    fn check_vault_liquidity(env: &Env, vault: &Address, amount: i128) -> Result<(), NoetherError> {
        // Call vault's reserve_for_position function
        // This checks liquidity without moving funds
        let args: Vec<soroban_sdk::Val> = (amount,).into_val(env);
        let _: () = env.invoke_contract(
            vault,
            &Symbol::new(env, "reserve_for_position"),
            args,
        );

        Ok(())
    }

    /// Settle PnL with vault contract.
    fn settle_with_vault(env: &Env, vault: &Address, pnl: i128) -> Result<(), NoetherError> {
        // Call vault's settle_pnl function
        // - If pnl > 0: Vault transfers profit to Market
        // - If pnl < 0: Vault updates accounting (Market transfers loss separately)
        let args: Vec<soroban_sdk::Val> = (pnl,).into_val(env);
        let _: () = env.invoke_contract(
            vault,
            &Symbol::new(env, "settle_pnl"),
            args,
        );

        Ok(())
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

        // Reduce Only check: bit 8 of time_in_force
        // A reduce-only entry order is only valid if the trader has an existing
        // position in the OPPOSITE direction that it would offset.
        if order.time_in_force & 0x100 != 0 {
            let all_ids = get_all_position_ids(env);
            let has_opposing = all_ids.iter().any(|pid| {
                if let Some(pos) = get_position(env, pid) {
                    pos.trader == order.trader
                        && pos.asset == order.asset
                        && pos.direction != order.direction
                } else {
                    false
                }
            });
            if !has_opposing {
                // No opposing position — cancel and refund
                let usdc_token = get_usdc_token(env);
                let token_client = token::Client::new(env, &usdc_token);
                token_client.transfer(&env.current_contract_address(), &order.trader, &order.collateral);
                update_order_status(env, order.id, OrderStatus::Cancelled);
                env.events().publish(
                    (Symbol::new(env, "order_cancelled"),),
                    (order.id, Symbol::new(env, "reduce_only_no_position")),
                );
                return Ok(0);
            }
        }

        // Calculate position size
        let size = calculate_position_size(order.collateral, order.leverage);

        // Check Vault has enough liquidity
        let vault_address = get_vault(env);
        Self::check_vault_liquidity(env, &vault_address, size)?;

        // Calculate liquidation price using current price as entry
        let liquidation_price = calculate_liquidation_price(
            current_price,
            order.leverage,
            order.direction.clone(),
            config.maintenance_margin_bps,
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
            direction: order.direction.clone(),
            leverage: order.leverage,
            liquidation_price,
            timestamp: env.ledger().timestamp(),
            entry_cumulative_funding: get_cumulative_funding_rate(env),
            margin_mode: 0, // Isolated
        };

        // Store position
        save_position(env, &position);

        // Update market stats
        match order.direction {
            Direction::Long => {
                let total = get_total_long_size(env);
                set_total_long_size(env, total + size);
            }
            Direction::Short => {
                let total = get_total_short_size(env);
                set_total_short_size(env, total + size);
            }
        }

        // Transfer trading fee to vault
        let usdc_token = get_usdc_token(env);
        let token_client = token::Client::new(env, &usdc_token);
        token_client.transfer(&env.current_contract_address(), &vault_address, &trading_fee);

        // Pay keeper fee
        if keeper_fee > 0 {
            token_client.transfer(&env.current_contract_address(), keeper, &keeper_fee);
        }

        env.events().publish(
            (Symbol::new(env, "position_opened"),),
            (position.id, order.trader.clone(), position.asset.clone(), position.direction.clone(), size, current_price),
        );

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

        // Calculate funding from cumulative rate
        let cumulative = get_cumulative_funding_rate(env);
        let funding = calculate_cumulative_funding(
            position.size, position.direction.clone(),
            position.entry_cumulative_funding, cumulative,
        );

        // Calculate PnL
        let pnl = calculate_pnl(&position, current_price)?;

        // Calculate amount to return to trader
        let to_trader = position.collateral + pnl - funding - keeper_fee;

        // Settle with vault
        let vault_address = get_vault(env);
        Self::settle_with_vault(env, &vault_address, pnl)?;

        // Get token client for transfers
        let usdc_token = get_usdc_token(env);
        let token_client = token::Client::new(env, &usdc_token);

        // If trader lost, transfer the loss amount to Vault
        if pnl < 0 {
            let loss = -pnl;
            token_client.transfer(&env.current_contract_address(), &vault_address, &loss);
        }

        // Transfer funding to vault if trader owes funding
        if funding > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &vault_address,
                &funding,
            );
        }

        // Pay keeper fee
        if keeper_fee > 0 {
            token_client.transfer(&env.current_contract_address(), keeper, &keeper_fee);
        }

        // Transfer to trader (if positive)
        if to_trader > 0 {
            token_client.transfer(&env.current_contract_address(), &position.trader, &to_trader);
        }

        // Update market stats
        match position.direction {
            Direction::Long => {
                let total = get_total_long_size(env);
                set_total_long_size(env, if total > position.size { total - position.size } else { 0 });
            }
            Direction::Short => {
                let total = get_total_short_size(env);
                set_total_short_size(env, if total > position.size { total - position.size } else { 0 });
            }
        }

        // Record volume for fee tier tracking
        record_volume_only(env, &position.trader, position.size);

        // Remove SL/TP links
        remove_position_stop_loss(env, position.id);
        remove_position_take_profit(env, position.id);

        // Delete position
        delete_position(env, position.id, &position.trader);

        env.events().publish(
            (Symbol::new(env, "position_closed"),),
            (position.id, position.trader.clone(), position.asset.clone(), position.direction.clone(), position.size, position.entry_price, current_price, pnl),
        );

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
        let env = Env::default();
        env.mock_all_auths();
        env.budget().reset_unlimited(); // Allow complex cross-contract tests

        // Set a realistic timestamp (so funding/volume day calc works)
        env.ledger().set_timestamp(1_700_000_000); // ~Nov 2023

        let admin = Address::generate(&env);

        // Deploy USDC token (SAC test token)
        let usdc_sac = env.register_stellar_asset_contract_v2(admin.clone());
        let usdc_token = usdc_sac.address();

        // Deploy mock oracle
        let oracle_id = env.register_contract_wasm(None, mock_oracle::WASM);
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
        usdc_admin.mint(&admin, &(10_000_000 * PRECISION)); // $10M
        vault_client.deposit(&admin, &(10_000_000 * PRECISION));

        // Initialize market with config
        let config = MarketConfig::default();
        market.initialize(&admin, &oracle_id, &vault_id, &usdc_token, &config);

        TestEnv { env, admin, market_id, market, usdc_token, vault_id, oracle_id }
    }

    fn fund_trader(test: &TestEnv, amount: i128) -> Address {
        let trader = Address::generate(&test.env);
        let usdc_admin = StellarAssetClient::new(&test.env, &test.usdc_token);
        usdc_admin.mint(&trader, &amount);
        trader
    }

    // Import contract WASMs for cross-contract testing
    mod mock_oracle {
        soroban_sdk::contractimport!(
            file = "../target/wasm32-unknown-unknown/release/mock_oracle.wasm"
        );
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
            &Direction::Long,
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

    #[test]
    fn test_open_position_long() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        let position = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
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
            &Direction::Short,
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
            &Direction::Long,
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
            &Direction::Long,
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
            &Direction::Long,
        );

        // Price goes up 10% to $0.11
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(PRECISION * 11 / 100));

        // Close position - should profit
        let pnl = test.market.close_position(&trader, &position.id);
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
            &Direction::Long,
        );

        // Price goes down 5% to $0.095
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(PRECISION * 95 / 1000));

        // Close position - should lose
        let pnl = test.market.close_position(&trader, &position.id);
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
            &Direction::Long,
        );
        assert_eq!(pos1.margin_mode, 1); // Cross

        // Open second cross position sharing collateral
        let pos2 = test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "ETH"),
            &(200 * PRECISION),
            &3,
            &Direction::Short,
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
            &Direction::Long,
        );

        // Price up 10% — profit
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(PRECISION * 11 / 100));

        let pnl = test.market.close_position_cross(&trader, &pos.id);
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
            &Direction::Long,
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
            &Direction::Long,
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
            &Direction::Long,
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
            &Direction::Long,
        );
        let pos2 = test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "ETH"),
            &(150 * PRECISION),
            &3,
            &Direction::Short,
        );

        // Close only the first position (partial account close)
        let pnl = test.market.close_position_cross(&trader, &pos1.id);
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
            &Direction::Long,
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
}
