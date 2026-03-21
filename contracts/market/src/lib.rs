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
    FeeTier, TraderFeeInfo, VolumeRecord, CrossMarginInfo, PRECISION, BASIS_POINTS,
    calculate_position_size, calculate_liquidation_price, calculate_pnl,
    calculate_trading_fee, calculate_funding_rate, calculate_funding_payment,
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
            last_funding_time: env.ledger().timestamp(),
            accumulated_funding: 0,
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
            (position.id, trader, asset, size, direction, leverage, entry_price),
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
        let mut position = get_position(&env, position_id)
            .ok_or(NoetherError::PositionNotFound)?;

        // Verify ownership
        if position.trader != trader {
            return Err(NoetherError::NotPositionOwner);
        }

        // Apply pending funding
        Self::apply_funding_to_position(&env, &mut position)?;

        // Get current price
        let current_price = Self::get_oracle_price(&env, &position.asset)?;

        // Calculate PnL
        let pnl = calculate_pnl(&position, current_price)?;

        // Calculate amount to return to trader
        let to_trader = position.collateral + pnl - position.accumulated_funding;

        // Settle with vault
        // - If pnl > 0: Vault transfers profit to Market
        // - If pnl < 0: Vault just updates accounting
        let vault_address = get_vault(&env);
        Self::settle_with_vault(&env, &vault_address, pnl)?;

        // Get token client for transfers
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);

        // If trader lost, transfer the loss amount to Vault
        // (Vault's settle_pnl already updated accounting, now transfer actual tokens)
        if pnl < 0 {
            let loss = -pnl;
            token_client.transfer(&env.current_contract_address(), &vault_address, &loss);
        }

        // Transfer remaining funding to vault (if any)
        if position.accumulated_funding > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &vault_address,
                &position.accumulated_funding,
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
                set_total_long_size(&env, total - position.size);
            }
            Direction::Short => {
                let total = get_total_short_size(&env);
                set_total_short_size(&env, total - position.size);
            }
        }

        // Record volume for fee tier tracking
        record_volume_only(&env, &trader, position.size);

        // Delete position
        delete_position(&env, position_id, &trader);

        // Emit comprehensive event with full trade data for frontend history
        env.events().publish(
            (Symbol::new(&env, "position_closed"),),
            (
                position_id,
                trader,
                position.asset,
                position.direction,
                position.size,
                position.entry_price,
                current_price,  // exit_price
                pnl,
                position.accumulated_funding,
            ),
        );

        extend_instance_ttl(&env);

        Ok(pnl)
    }

    /// Add collateral to an existing position.
    /// Reduces liquidation risk.
    pub fn add_collateral(
        env: Env,
        trader: Address,
        position_id: u64,
        amount: i128,
    ) -> Result<(), NoetherError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;

        if amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        trader.require_auth();

        // Get position
        let mut position = get_position(&env, position_id)
            .ok_or(NoetherError::PositionNotFound)?;

        if position.trader != trader {
            return Err(NoetherError::NotPositionOwner);
        }

        // Transfer additional collateral
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&trader, &env.current_contract_address(), &amount);

        // Update position
        position.collateral += amount;

        // Recalculate liquidation price with new effective leverage
        let config = get_config(&env);
        let new_leverage = (position.size / position.collateral) as u32;
        let effective_leverage = new_leverage.max(1).min(config.max_leverage);

        position.liquidation_price = calculate_liquidation_price(
            position.entry_price,
            effective_leverage,
            position.direction.clone(),
            config.maintenance_margin_bps,
        );

        // Save updated position
        save_position(&env, &position);

        env.events().publish(
            (Symbol::new(&env, "collateral_added"),),
            (position_id, amount, position.collateral),
        );

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

        // Get current price
        let current_price = Self::get_oracle_price(&env, &position.asset)?;

        // Check if liquidatable
        if !should_liquidate(&position, current_price) {
            return Err(NoetherError::NotLiquidatable);
        }

        let config = get_config(&env);

        // Calculate PnL
        let pnl = calculate_pnl(&position, current_price)?;

        // Calculate remaining collateral after PnL and funding
        let remaining = position.collateral + pnl - position.accumulated_funding;

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
                set_total_long_size(&env, total - position.size);
            }
            Direction::Short => {
                let total = get_total_short_size(&env);
                set_total_short_size(&env, total - position.size);
            }
        }

        // Delete position
        delete_position(&env, position_id, &position.trader);

        // Emit comprehensive event with full trade data for frontend history
        env.events().publish(
            (Symbol::new(&env, "position_liquidated"),),
            (
                position_id,
                position.trader,
                position.asset,
                position.direction,
                position.size,
                position.entry_price,
                current_price,
                pnl,
                keeper.clone(),
                actual_keeper_reward,
            ),
        );

        extend_instance_ttl(&env);

        Ok(actual_keeper_reward)
    }

    /// Check if a position can be liquidated.
    pub fn is_liquidatable(env: Env, position_id: u64) -> Result<bool, NoetherError> {
        let position = get_position(&env, position_id)
            .ok_or(NoetherError::PositionNotFound)?;

        let current_price = Self::get_oracle_price(&env, &position.asset)?;

        Ok(should_liquidate(&position, current_price))
    }

    /// Get all liquidatable positions (for keeper).
    /// Returns list of position IDs that can be liquidated.
    pub fn get_liquidatable_positions(env: Env, asset: Symbol) -> Result<Vec<u64>, NoetherError> {
        require_initialized(&env)?;

        let current_price = Self::get_oracle_price(&env, &asset)?;
        let all_positions = get_all_position_ids(&env);
        let mut liquidatable = Vec::new(&env);

        for i in 0..all_positions.len() {
            let pos_id = all_positions.get(i).unwrap();
            if let Some(position) = get_position(&env, pos_id) {
                if position.asset == asset && should_liquidate(&position, current_price) {
                    liquidatable.push_back(pos_id);
                }
            }
        }

        Ok(liquidatable)
    }

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

        // Store for reference
        set_current_funding_rate(&env, funding_rate);
        set_last_funding_time(&env, current_time);

        env.events().publish(
            (Symbol::new(&env, "funding_applied"),),
            (funding_rate, hours_elapsed),
        );

        Ok(())
    }

    /// Get current funding rate.
    pub fn get_funding_rate(env: Env) -> i128 {
        let config = get_config(&env);
        let total_long = get_total_long_size(&env);
        let total_short = get_total_short_size(&env);

        calculate_funding_rate(total_long, total_short, config.base_funding_rate_bps)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // View Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Get a position by ID.
    pub fn get_position(env: Env, position_id: u64) -> Option<Position> {
        get_position(&env, position_id)
    }

    /// Get all positions for a trader.
    pub fn get_positions(env: Env, trader: Address) -> Vec<Position> {
        get_trader_positions(&env, &trader)
    }

    /// Get position PnL at current price.
    pub fn get_position_pnl(env: Env, position_id: u64) -> Result<i128, NoetherError> {
        let position = get_position(&env, position_id)
            .ok_or(NoetherError::PositionNotFound)?;

        let current_price = Self::get_oracle_price(&env, &position.asset)?;
        calculate_pnl(&position, current_price)
    }

    /// Get market statistics.
    pub fn get_market_stats(env: Env) -> MarketStats {
        let funding_rate = Self::get_funding_rate(env.clone());

        MarketStats {
            total_long_size: get_total_long_size(&env),
            total_short_size: get_total_short_size(&env),
            open_position_count: get_position_count(&env),
            funding_rate,
            last_funding_time: get_last_funding_time(&env),
        }
    }

    /// Get all position IDs (for keeper iteration).
    pub fn get_all_position_ids(env: Env) -> Vec<u64> {
        get_all_position_ids(&env)
    }

    /// Get current price from oracle.
    pub fn get_price(env: Env, asset: Symbol) -> Result<i128, NoetherError> {
        Self::get_oracle_price(&env, &asset)
    }

    /// Get market configuration.
    pub fn get_config(env: Env) -> MarketConfig {
        get_config(&env)
    }

    /// Get vault address.
    pub fn get_vault(env: Env) -> Result<Address, NoetherError> {
        require_initialized(&env)?;
        Ok(get_vault(&env))
    }

    /// Get USDC token address.
    pub fn get_usdc_token(env: Env) -> Result<Address, NoetherError> {
        require_initialized(&env)?;
        Ok(get_usdc_token(&env))
    }

    /// Get USDC balance held by Market contract.
    pub fn get_usdc_balance(env: Env) -> Result<i128, NoetherError> {
        require_initialized(&env)?;
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        Ok(token_client.balance(&env.current_contract_address()))
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Admin Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Update market configuration.
    pub fn update_config(env: Env, config: MarketConfig) -> Result<(), NoetherError> {
        require_admin(&env)?;

        // Validate config
        if config.max_leverage < 1 || config.max_leverage > 100 {
            return Err(NoetherError::InvalidParameter);
        }

        set_config(&env, &config);

        env.events().publish(
            (Symbol::new(&env, "config_updated"),),
            (),
        );

        Ok(())
    }

    /// Update oracle adapter address.
    pub fn set_oracle_adapter(env: Env, oracle: Address) -> Result<(), NoetherError> {
        require_admin(&env)?;
        let old = get_oracle_adapter(&env);
        set_oracle_adapter(&env, &oracle);

        env.events().publish(
            (Symbol::new(&env, "oracle_updated"),),
            (old, oracle),
        );

        Ok(())
    }

    /// Update vault address.
    pub fn set_vault(env: Env, vault: Address) -> Result<(), NoetherError> {
        require_admin(&env)?;
        let old = get_vault(&env);
        set_vault(&env, &vault);

        env.events().publish(
            (Symbol::new(&env, "vault_updated"),),
            (old, vault),
        );

        Ok(())
    }

    /// Pause the market (emergency).
    pub fn pause(env: Env) -> Result<(), NoetherError> {
        require_admin(&env)?;
        set_paused(&env, true);

        env.events().publish(
            (Symbol::new(&env, "paused"),),
            (),
        );

        Ok(())
    }

    /// Unpause the market.
    pub fn unpause(env: Env) -> Result<(), NoetherError> {
        require_admin(&env)?;
        set_paused(&env, false);

        env.events().publish(
            (Symbol::new(&env, "unpaused"),),
            (),
        );

        Ok(())
    }

    /// Transfer admin role.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), NoetherError> {
        require_admin(&env)?;
        new_admin.require_auth();

        let old = get_admin(&env);
        set_admin(&env, &new_admin);

        env.events().publish(
            (Symbol::new(&env, "admin_updated"),),
            (old, new_admin),
        );

        Ok(())
    }

    /// Get admin address.
    pub fn get_admin(env: Env) -> Result<Address, NoetherError> {
        require_initialized(&env)?;
        Ok(get_admin(&env))
    }

    /// Check if paused.
    pub fn is_paused(env: Env) -> bool {
        get_paused(&env)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Fee Tier Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Admin: Set fee tier configuration.
    /// Tiers must be sorted by min_volume ascending.
    pub fn set_fee_tiers_config(
        env: Env,
        tiers: Vec<FeeTier>,
    ) -> Result<(), NoetherError> {
        require_admin(&env)?;

        if tiers.len() == 0 {
            return Err(NoetherError::InvalidParameter);
        }

        // Validate tiers are sorted by min_volume
        let mut prev_volume: i128 = -1;
        for i in 0..tiers.len() {
            let tier = tiers.get(i).unwrap();
            if tier.min_volume <= prev_volume {
                return Err(NoetherError::InvalidParameter);
            }
            prev_volume = tier.min_volume;
        }

        set_fee_tiers(&env, &tiers);

        env.events().publish(
            (Symbol::new(&env, "fee_tiers_updated"),),
            tiers.len(),
        );

        Ok(())
    }

    /// View: Get current fee tier configuration.
    pub fn get_fee_tiers_config(env: Env) -> Vec<FeeTier> {
        get_fee_tiers(&env)
    }

    /// View: Get a trader's fee information (volume, tier, rates).
    pub fn get_trader_fee_info(
        env: Env,
        trader: Address,
    ) -> TraderFeeInfo {
        let fee_tiers = get_fee_tiers(&env);
        let volume_record = get_trader_volume(&env, &trader);

        let volume = match volume_record {
            Some(mut record) => {
                let current_day = trading::timestamp_to_day(env.ledger().timestamp());
                trading::rotate_volume_window(&env, &mut record, current_day);
                trading::sum_rolling_volume(&record)
            }
            None => 0,
        };

        if fee_tiers.len() == 0 {
            // No tiers configured, return base info
            let config = get_config(&env);
            return TraderFeeInfo {
                volume_14d: volume,
                tier: 0,
                maker_fee_bps: config.base_maker_fee_bps,
                taker_fee_bps: config.base_taker_fee_bps,
                next_tier_volume: 0,
            };
        }

        trading::build_trader_fee_info(&env, volume, &fee_tiers)
    }

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

        env.events().publish(
            (Symbol::new(&env, "cross_margin_deposit"),),
            (trader, amount, new_balance),
        );

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

        env.events().publish(
            (Symbol::new(&env, "cross_margin_withdraw"),),
            (trader, amount, new_balance),
        );

        Ok(())
    }

    /// Open a position using cross-margin pool.
    /// Collateral param = initial margin deducted from pool.
    /// Liquidation is account-level (no per-position liquidation price).
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

        // Check cross-margin pool has enough balance
        let pool_balance = get_cross_margin_balance(&env, &trader);
        if collateral > pool_balance {
            return Err(NoetherError::CrossMarginInsufficientBalance);
        }

        // Check vault liquidity
        let vault_address = get_vault(&env);
        Self::check_vault_liquidity(&env, &vault_address, size)?;

        // Fetch price from oracle
        let entry_price = Self::get_oracle_price(&env, &asset)?;

        // Calculate taker fee and record volume
        let fee = calculate_fee_and_record_volume(&env, &trader, size, false, &config);

        let net_collateral = collateral - fee;

        // Deduct from cross-margin pool (not from wallet - already deposited)
        let new_balance = pool_balance - collateral;
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
            last_funding_time: env.ledger().timestamp(),
            accumulated_funding: 0,
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
            (Symbol::new(&env, "position_opened_cross"),),
            (position_id, trader, asset, size, direction, leverage, entry_price),
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

        let mut pos = get_position(&env, position_id)
            .ok_or(NoetherError::PositionNotFound)?;

        if pos.trader != trader {
            return Err(NoetherError::NotPositionOwner);
        }
        if pos.margin_mode != 1 {
            return Err(NoetherError::InvalidParameter); // Not a cross-margin position
        }

        // Apply pending funding
        Self::apply_funding_to_position(&env, &mut pos)?;

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
        if pos.accumulated_funding > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &vault_address,
                &pos.accumulated_funding,
            );
        }

        // Return remaining equity to cross-margin pool (NOT trader wallet)
        let to_pool = pos.collateral + pnl - pos.accumulated_funding;
        if to_pool > 0 {
            let current_balance = get_cross_margin_balance(&env, &trader);
            set_cross_margin_balance(&env, &trader, current_balance + to_pool);
        }

        // Record volume
        record_volume_only(&env, &trader, pos.size);

        // Update market stats
        match pos.direction {
            Direction::Long => {
                let total = get_total_long_size(&env);
                set_total_long_size(&env, total - pos.size);
            }
            Direction::Short => {
                let total = get_total_short_size(&env);
                set_total_short_size(&env, total - pos.size);
            }
        }

        // Clean up
        remove_cross_margin_position(&env, &trader, position_id);
        delete_position(&env, position_id, &trader);

        extend_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "position_closed_cross"),),
            (position_id, trader, pos.asset, pnl),
        );

        Ok(pnl)
    }

    /// Check if a cross-margin account is liquidatable.
    /// Liquidatable when account equity < aggregate maintenance margin.
    pub fn is_cross_liquidatable(env: Env, trader: Address) -> Result<bool, NoetherError> {
        require_initialized(&env)?;

        let config = get_config(&env);
        let get_price = |asset: &Symbol| -> i128 {
            Self::get_oracle_price(&env, asset).unwrap_or(0)
        };

        Ok(position::is_cross_account_liquidatable(
            &env, &trader, config.maintenance_margin_bps, &get_price,
        ))
    }

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
        let get_price = |asset: &Symbol| -> i128 {
            Self::get_oracle_price(&env, asset).unwrap_or(0)
        };

        // Verify account is liquidatable
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

        for i in 0..position_ids.len() {
            let pid = position_ids.get(i).unwrap();
            if let Some(pos) = get_position(&env, pid) {
                let current_price = Self::get_oracle_price(&env, &pos.asset).unwrap_or(0);
                let pnl = calculate_pnl(&pos, current_price).unwrap_or(0);

                // Settle accounting with vault
                let _ = Self::settle_with_vault(&env, &vault_address, pnl);

                if pnl < 0 {
                    total_loss_to_vault += -pnl;
                }

                // Update market stats
                match pos.direction {
                    Direction::Long => {
                        let total = get_total_long_size(&env);
                        set_total_long_size(&env, total - pos.size);
                    }
                    Direction::Short => {
                        let total = get_total_short_size(&env);
                        set_total_short_size(&env, total - pos.size);
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

        // Send any remaining to vault
        let final_balance = token_client.balance(&market_addr);
        // Only send what belongs to this liquidation (not other traders' deposits)
        // We know the trader's total was: balance (pool) + sum(collateral in positions)
        // After all settlements, whatever is left from their account goes to vault
        let trader_remaining = final_balance; // Simplified: in practice we'd track precisely
        if trader_remaining > 0 && equity > keeper_reward {
            let to_vault = equity - keeper_reward;
            let actual_to_vault = if to_vault > trader_remaining { trader_remaining } else { to_vault };
            if actual_to_vault > 0 {
                token_client.transfer(&market_addr, &vault_address, &actual_to_vault);
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
            (Symbol::new(&env, "cross_margin_liquidated"),),
            (trader, keeper_reward, position_ids.len()),
        );

        Ok(keeper_reward)
    }

    /// Get cross-margin account info for a trader.
    pub fn get_cross_margin_info(env: Env, trader: Address) -> CrossMarginInfo {
        let get_price = |asset: &Symbol| -> i128 {
            Self::get_oracle_price(&env, asset).unwrap_or(0)
        };
        position::build_cross_margin_info(&env, &trader, &get_price)
    }

    /// Get all traders with cross-margin accounts (for keeper scanning).
    pub fn get_cross_margin_traders(env: Env) -> Vec<Address> {
        get_all_cross_margin_traders(&env)
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

        // Calculate position size to check against limits
        let size = calculate_position_size(collateral, leverage);
        if size > config.max_position_size {
            return Err(NoetherError::PositionTooLarge);
        }

        // Transfer collateral from trader to market contract (lock it)
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&trader, &env.current_contract_address(), &collateral);

        // Generate order ID
        let order_id = next_order_id(&env);

        // Create order
        let trigger_condition = if trigger_above {
            TriggerCondition::Above
        } else {
            TriggerCondition::Below
        };

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
        };

        // Store order
        save_order(&env, &order);

        extend_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "order_placed"),),
            (order_id, trader, asset, OrderType::LimitEntry, trigger_price, direction),
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
        };

        // Store order and link to position
        save_order(&env, &order);
        set_position_stop_loss(&env, position_id, order_id);

        extend_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "stop_loss_set"),),
            (order_id, position_id, trigger_price),
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
        };

        // Store order and link to position
        save_order(&env, &order);
        set_position_take_profit(&env, position_id, order_id);

        extend_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "take_profit_set"),),
            (order_id, position_id, trigger_price),
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

        // Refund collateral for limit orders
        if order.order_type == OrderType::LimitEntry && order.collateral > 0 {
            let usdc_token = get_usdc_token(&env);
            let token_client = token::Client::new(&env, &usdc_token);
            token_client.transfer(&env.current_contract_address(), &trader, &order.collateral);
        }

        // Remove SL/TP links if attached to position
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
            (order_id, trader, Symbol::new(&env, "user_cancelled")),
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

        // Check if trigger condition is met
        let triggered = match order.trigger_condition {
            TriggerCondition::Above => current_price >= order.trigger_price,
            TriggerCondition::Below => current_price <= order.trigger_price,
        };

        if !triggered {
            return Err(NoetherError::OrderNotTriggered);
        }

        // Check slippage
        let price_diff = if current_price > order.trigger_price {
            current_price - order.trigger_price
        } else {
            order.trigger_price - current_price
        };
        let actual_slippage_bps = (price_diff * 10_000) / order.trigger_price;

        if actual_slippage_bps > order.slippage_tolerance_bps as i128 {
            // Slippage exceeded - cancel the order and commit the cancellation
            // IMPORTANT: We return Ok(0) instead of Err() so the transaction commits
            // and the order is properly removed from the pending list. Returning Err()
            // would rollback all state changes, leaving the order stuck in pending.

            if order.order_type == OrderType::LimitEntry && order.collateral > 0 {
                // Refund collateral
                let usdc_token = get_usdc_token(&env);
                let token_client = token::Client::new(&env, &usdc_token);
                token_client.transfer(&env.current_contract_address(), &order.trader, &order.collateral);
            }

            // Remove SL/TP links
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
                (order_id, order.trader.clone(), Symbol::new(&env, "slippage_exceeded")),
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
        };

        match result {
            Ok(reward) => {
                update_order_status(&env, order_id, OrderStatus::Executed);

                extend_instance_ttl(&env);

                env.events().publish(
                    (Symbol::new(&env, "order_executed"),),
                    (order_id, order.trader, order.order_type, current_price, reward),
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

        let triggered = match order.trigger_condition {
            TriggerCondition::Above => current_price >= order.trigger_price,
            TriggerCondition::Below => current_price <= order.trigger_price,
        };

        Ok(triggered)
    }

    /// Get all orders for a trader.
    pub fn get_orders(env: Env, trader: Address) -> Vec<Order> {
        get_trader_orders(&env, &trader)
    }

    /// Get a specific order by ID.
    pub fn get_order(env: Env, order_id: u64) -> Option<Order> {
        get_order(&env, order_id)
    }

    /// Get all pending order IDs (for keeper).
    pub fn get_all_order_ids(env: Env) -> Vec<u64> {
        get_all_order_ids(&env)
    }

    /// Get stop-loss order ID attached to a position.
    pub fn get_position_sl(env: Env, position_id: u64) -> Option<u64> {
        get_position_stop_loss(&env, position_id)
    }

    /// Get take-profit order ID attached to a position.
    pub fn get_position_tp(env: Env, position_id: u64) -> Option<u64> {
        get_position_take_profit(&env, position_id)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Internal Functions
    // ═══════════════════════════════════════════════════════════════════════

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

    /// Apply pending funding to a position.
    fn apply_funding_to_position(env: &Env, position: &mut Position) -> Result<(), NoetherError> {
        let current_time = env.ledger().timestamp();
        let hours_elapsed = (current_time - position.last_funding_time) / 3600;

        if hours_elapsed == 0 {
            return Ok(());
        }

        let funding_rate = get_current_funding_rate(env);
        let funding_payment = calculate_funding_payment(
            position.size,
            funding_rate,
            position.direction.clone(),
            hours_elapsed,
        );

        position.accumulated_funding += funding_payment;
        position.last_funding_time = current_time;

        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Internal Order Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Calculate keeper fee for order execution.
    /// Fee = base_fee (0.50 USDC) + variable_fee (0.05% of position size)
    fn calculate_keeper_order_fee(env: &Env, order: &Order) -> i128 {
        let fee_config = KeeperFeeConfig::default();

        let position_size = match order.order_type {
            OrderType::LimitEntry => calculate_position_size(order.collateral, order.leverage),
            OrderType::StopLoss | OrderType::TakeProfit => {
                // For SL/TP, get size from the position
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
            last_funding_time: env.ledger().timestamp(),
            accumulated_funding: 0,
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

        // Emit position opened event
        env.events().publish(
            (Symbol::new(env, "position_opened"),),
            (position.id, order.trader.clone(), order.asset.clone(), size, order.direction.clone(), order.leverage, current_price),
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
        let mut position = get_position(env, order.position_id)
            .ok_or(NoetherError::PositionNotFound)?;

        // Apply pending funding
        Self::apply_funding_to_position(env, &mut position)?;

        // Calculate PnL
        let pnl = calculate_pnl(&position, current_price)?;

        // Calculate amount to return to trader
        let to_trader = position.collateral + pnl - position.accumulated_funding - keeper_fee;

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

        // Transfer remaining funding to vault
        if position.accumulated_funding > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &vault_address,
                &position.accumulated_funding,
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
                set_total_long_size(env, total - position.size);
            }
            Direction::Short => {
                let total = get_total_short_size(env);
                set_total_short_size(env, total - position.size);
            }
        }

        // Record volume for fee tier tracking
        record_volume_only(env, &position.trader, position.size);

        // Remove SL/TP links
        remove_position_stop_loss(env, position.id);
        remove_position_take_profit(env, position.id);

        // Delete position
        delete_position(env, position.id, &position.trader);

        // Emit position closed event
        env.events().publish(
            (Symbol::new(env, "position_closed"),),
            (
                position.id,
                position.trader,
                position.asset,
                position.direction,
                position.size,
                position.entry_price,
                current_price,
                pnl,
                position.accumulated_funding,
            ),
        );

        Ok(keeper_fee)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger as _}, token::StellarAssetClient, Env, Address, Symbol};
    use noether_common::{PRECISION, FeeTier, MarketConfig};

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
    // T1.3 Fee Tier Tests - Contract Integration
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_open_position_charges_taker_fee() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION); // $1000

        let position = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION), // $100 collateral
            &5,                  // 5x leverage = $500 position
            &Direction::Long,
        );

        // Taker fee at tier 0 = 0.05% of $500 = $0.25
        // net_collateral = $100 - $0.25 = $99.75
        let expected_fee = 500 * PRECISION * 5 / 10_000; // 0.05% of $500
        let expected_collateral = 100 * PRECISION - expected_fee;
        assert_eq!(position.collateral, expected_collateral);
    }

    #[test]
    fn test_default_fee_tiers_set_on_init() {
        let test = setup();

        let tiers = test.market.get_fee_tiers_config();
        assert_eq!(tiers.len(), 4);

        // Tier 0: base
        let t0 = tiers.get(0).unwrap();
        assert_eq!(t0.maker_fee_bps, 2);
        assert_eq!(t0.taker_fee_bps, 5);
    }

    #[test]
    fn test_get_trader_fee_info_no_volume() {
        let test = setup();
        let trader = Address::generate(&test.env);

        let info = test.market.get_trader_fee_info(&trader);
        assert_eq!(info.volume_14d, 0);
        assert_eq!(info.tier, 0);
        assert_eq!(info.maker_fee_bps, 2);
        assert_eq!(info.taker_fee_bps, 5);
    }

    #[test]
    fn test_volume_recorded_on_open_position() {
        let test = setup();
        let trader = fund_trader(&test, 10_000 * PRECISION);

        // Open position: $100 collateral, 5x = $500 size
        test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
        );

        let info = test.market.get_trader_fee_info(&trader);
        assert_eq!(info.volume_14d, 500 * PRECISION); // $500 position size recorded
    }

    #[test]
    fn test_volume_accumulates_multiple_trades() {
        let test = setup();
        let trader = fund_trader(&test, 10_000 * PRECISION);

        // Trade 1: $500
        test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
        );

        // Trade 2: $1000
        test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &10,
            &Direction::Short,
        );

        let info = test.market.get_trader_fee_info(&trader);
        assert_eq!(info.volume_14d, 1500 * PRECISION); // $500 + $1000
    }

    #[test]
    fn test_admin_set_fee_tiers() {
        let test = setup();

        // Set custom tiers
        let mut tiers = Vec::new(&test.env);
        tiers.push_back(FeeTier {
            min_volume: 0,
            maker_fee_bps: 3,
            taker_fee_bps: 8,
        });
        tiers.push_back(FeeTier {
            min_volume: 500_000 * PRECISION,
            maker_fee_bps: 1,
            taker_fee_bps: 4,
        });

        test.market.set_fee_tiers_config(&tiers);

        let stored = test.market.get_fee_tiers_config();
        assert_eq!(stored.len(), 2);
        assert_eq!(stored.get(0).unwrap().taker_fee_bps, 8);
        assert_eq!(stored.get(1).unwrap().taker_fee_bps, 4);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")] // InvalidParameter
    fn test_set_fee_tiers_invalid_order() {
        let test = setup();

        // Tiers not sorted by min_volume - should fail
        let mut tiers = Vec::new(&test.env);
        tiers.push_back(FeeTier {
            min_volume: 1_000_000 * PRECISION,
            maker_fee_bps: 1,
            taker_fee_bps: 3,
        });
        tiers.push_back(FeeTier {
            min_volume: 0, // lower than previous - invalid!
            maker_fee_bps: 2,
            taker_fee_bps: 5,
        });

        test.market.set_fee_tiers_config(&tiers);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")] // InvalidParameter
    fn test_set_fee_tiers_empty() {
        let test = setup();
        let tiers = Vec::new(&test.env);
        test.market.set_fee_tiers_config(&tiers);
    }

    #[test]
    fn test_custom_taker_fee_applied() {
        let test = setup();

        // Set higher taker fee
        let mut tiers = Vec::new(&test.env);
        tiers.push_back(FeeTier {
            min_volume: 0,
            maker_fee_bps: 2,
            taker_fee_bps: 10, // 0.1% (same as old flat fee)
        });
        test.market.set_fee_tiers_config(&tiers);

        let trader = fund_trader(&test, 10_000 * PRECISION);

        let position = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION), // $100
            &10,                 // 10x = $1000
            &Direction::Long,
        );

        // 0.1% of $1000 = $1
        let expected_fee = 1000 * PRECISION * 10 / 10_000;
        let expected_collateral = 100 * PRECISION - expected_fee;
        assert_eq!(position.collateral, expected_collateral);
    }

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

    #[test]
    fn test_close_position_records_volume() {
        let test = setup();
        let trader = fund_trader(&test, 10_000 * PRECISION);

        let position = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
        );

        // Volume after open: $500
        let info1 = test.market.get_trader_fee_info(&trader);
        assert_eq!(info1.volume_14d, 500 * PRECISION);

        // Close - volume should add another $500
        test.market.close_position(&trader, &position.id);

        let info2 = test.market.get_trader_fee_info(&trader);
        assert_eq!(info2.volume_14d, 1000 * PRECISION);
    }

    #[test]
    fn test_add_collateral() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        let position = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
        );

        let original_collateral = position.collateral;

        // Add $50 collateral
        test.market.add_collateral(&trader, &position.id, &(50 * PRECISION));

        let updated = test.market.get_position(&position.id).unwrap();
        assert_eq!(updated.collateral, original_collateral + 50 * PRECISION);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Liquidation Tests
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_is_liquidatable_healthy_position() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        let position = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &10,
            &Direction::Long,
        );

        assert_eq!(test.market.is_liquidatable(&position.id), false);
    }

    #[test]
    fn test_is_liquidatable_underwater() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        // Open 10x long at $0.10
        let position = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &10,
            &Direction::Long,
        );

        // Crash price to $0.05 (50% drop, 10x leverage = 500% loss)
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(PRECISION * 5 / 100));

        assert_eq!(test.market.is_liquidatable(&position.id), true);
    }

    #[test]
    fn test_liquidation_execution() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);
        let keeper = Address::generate(&test.env);

        // Open 10x long at $0.10
        let position = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &10,
            &Direction::Long,
        );

        // Crash price below liquidation
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(PRECISION * 5 / 100));

        // Keeper liquidates
        let reward = test.market.liquidate(&keeper, &position.id);
        assert!(reward >= 0);

        // Position should be deleted
        let pos = test.market.get_position(&position.id);
        assert!(pos.is_none());
    }

    // ═══════════════════════════════════════════════════════════════════
    // Order Tests
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_place_limit_order() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        // Place limit long: buy XLM if price drops to $0.08
        let order = test.market.place_limit_order(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &Direction::Long,
            &(100 * PRECISION), // $100 collateral
            &5,                  // 5x
            &(PRECISION * 8 / 100), // trigger at $0.08
            &false,              // trigger below
            &100,                // 1% slippage
        );

        assert_eq!(order.id, 1);
        assert_eq!(order.collateral, 100 * PRECISION);
    }

    #[test]
    fn test_cancel_limit_order_refund() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        let usdc = token::Client::new(&test.env, &test.usdc_token);
        let balance_before = usdc.balance(&trader);

        // Place limit order - locks $100
        let order = test.market.place_limit_order(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &Direction::Long,
            &(100 * PRECISION),
            &5,
            &(PRECISION * 8 / 100),
            &false,
            &100,
        );

        let balance_after_order = usdc.balance(&trader);
        assert_eq!(balance_after_order, balance_before - 100 * PRECISION);

        // Cancel - should refund
        test.market.cancel_order(&trader, &order.id);

        let balance_after_cancel = usdc.balance(&trader);
        assert_eq!(balance_after_cancel, balance_before);
    }

    #[test]
    fn test_set_stop_loss() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        let position = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
        );

        // Set SL at $0.09 (below entry of $0.10)
        let sl = test.market.set_stop_loss(
            &trader,
            &position.id,
            &(PRECISION * 9 / 100),
            &200, // 2% slippage
        );

        assert_eq!(sl.position_id, position.id);
    }

    #[test]
    fn test_set_take_profit() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        let position = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
        );

        // Set TP at $0.12 (above entry of $0.10)
        let tp = test.market.set_take_profit(
            &trader,
            &position.id,
            &(PRECISION * 12 / 100),
            &200,
        );

        assert_eq!(tp.position_id, position.id);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Market Stats & View Tests
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_market_stats_update() {
        let test = setup();
        let trader = fund_trader(&test, 10_000 * PRECISION);

        let stats_before = test.market.get_market_stats();
        assert_eq!(stats_before.total_long_size, 0);
        assert_eq!(stats_before.total_short_size, 0);
        assert_eq!(stats_before.open_position_count, 0);

        // Open long $500
        test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
        );

        let stats = test.market.get_market_stats();
        assert_eq!(stats.total_long_size, 500 * PRECISION);
        assert_eq!(stats.open_position_count, 1);

        // Open short $1000
        test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &10,
            &Direction::Short,
        );

        let stats2 = test.market.get_market_stats();
        assert_eq!(stats2.total_short_size, 1000 * PRECISION);
        assert_eq!(stats2.open_position_count, 2);
    }

    #[test]
    fn test_get_config() {
        let test = setup();
        let config = test.market.get_config();

        assert_eq!(config.max_leverage, 10);
        assert_eq!(config.min_collateral, 10 * PRECISION);
        assert_eq!(config.base_maker_fee_bps, 2);
        assert_eq!(config.base_taker_fee_bps, 5);
    }

    #[test]
    fn test_pause_unpause() {
        let test = setup();

        assert_eq!(test.market.is_paused(), false);

        test.market.pause();
        assert_eq!(test.market.is_paused(), true);

        test.market.unpause();
        assert_eq!(test.market.is_paused(), false);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")] // Paused
    fn test_cannot_trade_when_paused() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        test.market.pause();

        test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
        );
    }

    #[test]
    fn test_multiple_positions_same_trader() {
        let test = setup();
        let trader = fund_trader(&test, 10_000 * PRECISION);

        let p1 = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
        );

        let p2 = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "BTC"),
            &(200 * PRECISION),
            &3,
            &Direction::Short,
        );

        assert_ne!(p1.id, p2.id);

        let positions = test.market.get_positions(&trader);
        assert_eq!(positions.len(), 2);
    }

    // ═══════════════════════════════════════════════════════════════════
    // T1.1 Cross-Margin Tests
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_deposit_cross_margin() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        test.market.deposit_cross_margin(&trader, &(500 * PRECISION));

        let info = test.market.get_cross_margin_info(&trader);
        assert_eq!(info.balance, 500 * PRECISION);
        assert_eq!(info.position_count, 0);
    }

    #[test]
    fn test_withdraw_cross_margin() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        test.market.deposit_cross_margin(&trader, &(500 * PRECISION));
        test.market.withdraw_cross_margin(&trader, &(200 * PRECISION));

        let info = test.market.get_cross_margin_info(&trader);
        assert_eq!(info.balance, 300 * PRECISION);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #76)")] // CrossMarginInsufficientBalance
    fn test_withdraw_cross_margin_exceeds_balance() {
        let test = setup();
        let trader = fund_trader(&test, 1_000 * PRECISION);

        test.market.deposit_cross_margin(&trader, &(100 * PRECISION));
        test.market.withdraw_cross_margin(&trader, &(200 * PRECISION)); // More than deposited
    }

    #[test]
    fn test_open_cross_margin_position() {
        let test = setup();
        let trader = fund_trader(&test, 5_000 * PRECISION);

        // Deposit $1000 to cross-margin pool
        test.market.deposit_cross_margin(&trader, &(1_000 * PRECISION));

        // Open position: $100 initial margin from pool, 5x = $500
        let pos = test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
        );

        assert_eq!(pos.margin_mode, 1); // Cross
        assert_eq!(pos.liquidation_price, 0); // No per-position liq price
        assert_eq!(pos.size, 500 * PRECISION);

        // Pool balance should decrease by collateral
        let info = test.market.get_cross_margin_info(&trader);
        assert_eq!(info.balance, 900 * PRECISION); // $1000 - $100
        assert_eq!(info.position_count, 1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #76)")] // CrossMarginInsufficientBalance
    fn test_open_cross_exceeds_pool_balance() {
        let test = setup();
        let trader = fund_trader(&test, 5_000 * PRECISION);

        test.market.deposit_cross_margin(&trader, &(50 * PRECISION));

        // Try to open with $100 margin but only $50 in pool
        test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
        );
    }

    #[test]
    fn test_cross_margin_two_positions_share_pool() {
        let test = setup();
        let trader = fund_trader(&test, 5_000 * PRECISION);

        test.market.deposit_cross_margin(&trader, &(1_000 * PRECISION));

        // Position 1: $200 margin, 5x
        test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(200 * PRECISION),
            &5,
            &Direction::Long,
        );

        // Position 2: $300 margin, 3x
        test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "BTC"),
            &(300 * PRECISION),
            &3,
            &Direction::Short,
        );

        let info = test.market.get_cross_margin_info(&trader);
        assert_eq!(info.balance, 500 * PRECISION); // $1000 - $200 - $300
        assert_eq!(info.position_count, 2);
    }

    #[test]
    fn test_close_cross_position_pnl_returns_to_pool() {
        let test = setup();
        let trader = fund_trader(&test, 5_000 * PRECISION);

        test.market.deposit_cross_margin(&trader, &(1_000 * PRECISION));

        let pos = test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
        );

        let info_before = test.market.get_cross_margin_info(&trader);

        // Price goes up 10%
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(PRECISION * 11 / 100));

        let pnl = test.market.close_position_cross(&trader, &pos.id);
        assert!(pnl > 0);

        let info_after = test.market.get_cross_margin_info(&trader);
        // Pool should have received collateral + profit back
        assert!(info_after.balance > info_before.balance);
        assert_eq!(info_after.position_count, 0);
    }

    #[test]
    fn test_cross_margin_not_liquidatable_healthy() {
        let test = setup();
        let trader = fund_trader(&test, 5_000 * PRECISION);

        test.market.deposit_cross_margin(&trader, &(1_000 * PRECISION));

        test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
        );

        assert_eq!(test.market.is_cross_liquidatable(&trader), false);
    }

    #[test]
    fn test_cross_margin_liquidatable_when_equity_drops() {
        let test = setup();
        let trader = fund_trader(&test, 5_000 * PRECISION);

        // Small deposit, high leverage
        test.market.deposit_cross_margin(&trader, &(110 * PRECISION));

        test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &10,
            &Direction::Long,
        );

        // Crash price 50%: $0.10 → $0.05
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(PRECISION * 5 / 100));

        assert_eq!(test.market.is_cross_liquidatable(&trader), true);
    }

    #[test]
    fn test_cross_margin_liquidation_execution() {
        let test = setup();
        let trader = fund_trader(&test, 5_000 * PRECISION);
        let keeper = Address::generate(&test.env);

        test.market.deposit_cross_margin(&trader, &(110 * PRECISION));

        // Open 10x long
        test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &10,
            &Direction::Long,
        );

        // Crash price
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(PRECISION * 5 / 100));

        let reward = test.market.liquidate_cross_account(&keeper, &trader);
        assert!(reward >= 0);

        // All positions should be gone
        let info = test.market.get_cross_margin_info(&trader);
        assert_eq!(info.position_count, 0);
        assert_eq!(info.balance, 0);
    }

    #[test]
    fn test_cross_margin_multi_position_liquidation() {
        let test = setup();
        let trader = fund_trader(&test, 10_000 * PRECISION);
        let keeper = Address::generate(&test.env);

        test.market.deposit_cross_margin(&trader, &(300 * PRECISION));

        // Open 2 positions
        test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &10,
            &Direction::Long,
        );
        test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "ETH"),
            &(100 * PRECISION),
            &10,
            &Direction::Long,
        );

        let info = test.market.get_cross_margin_info(&trader);
        assert_eq!(info.position_count, 2);

        // Crash both prices
        let oracle = mock_oracle::Client::new(&test.env, &test.oracle_id);
        oracle.set_price(&Symbol::new(&test.env, "XLM"), &(PRECISION * 3 / 100));
        oracle.set_price(&Symbol::new(&test.env, "ETH"), &(1_500 * PRECISION));

        // Should be liquidatable now
        assert_eq!(test.market.is_cross_liquidatable(&trader), true);

        // Liquidate - closes ALL positions
        test.market.liquidate_cross_account(&keeper, &trader);

        let info_after = test.market.get_cross_margin_info(&trader);
        assert_eq!(info_after.position_count, 0);
        assert_eq!(info_after.balance, 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #78)")] // CrossMarginNotLiquidatable
    fn test_cannot_liquidate_healthy_cross_account() {
        let test = setup();
        let trader = fund_trader(&test, 5_000 * PRECISION);
        let keeper = Address::generate(&test.env);

        test.market.deposit_cross_margin(&trader, &(1_000 * PRECISION));

        test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
        );

        // Try to liquidate healthy account - should fail
        test.market.liquidate_cross_account(&keeper, &trader);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #77)")] // CrossMarginInsufficientFreeMargin
    fn test_cannot_withdraw_when_margin_insufficient() {
        let test = setup();
        let trader = fund_trader(&test, 5_000 * PRECISION);

        test.market.deposit_cross_margin(&trader, &(200 * PRECISION));

        // Open position using $100 from pool
        test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &10,
            &Direction::Long,
        );

        // Try to withdraw almost all remaining - should fail (would breach maintenance)
        test.market.withdraw_cross_margin(&trader, &(95 * PRECISION));
    }

    #[test]
    fn test_cross_margin_isolated_independent() {
        let test = setup();
        let trader = fund_trader(&test, 10_000 * PRECISION);

        // Open isolated position
        let iso_pos = test.market.open_position(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
        );
        assert_eq!(iso_pos.margin_mode, 0); // Isolated

        // Open cross position (separate pool)
        test.market.deposit_cross_margin(&trader, &(500 * PRECISION));
        let cross_pos = test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "BTC"),
            &(100 * PRECISION),
            &3,
            &Direction::Short,
        );
        assert_eq!(cross_pos.margin_mode, 1); // Cross

        // Both should exist independently
        let all_positions = test.market.get_positions(&trader);
        assert_eq!(all_positions.len(), 2);

        let cross_info = test.market.get_cross_margin_info(&trader);
        assert_eq!(cross_info.position_count, 1); // Only cross counted here
    }

    #[test]
    fn test_get_cross_margin_traders() {
        let test = setup();
        let trader1 = fund_trader(&test, 5_000 * PRECISION);
        let trader2 = fund_trader(&test, 5_000 * PRECISION);

        test.market.deposit_cross_margin(&trader1, &(100 * PRECISION));
        test.market.deposit_cross_margin(&trader2, &(200 * PRECISION));

        let traders = test.market.get_cross_margin_traders();
        assert_eq!(traders.len(), 2);
    }

    #[test]
    fn test_cross_margin_volume_recorded() {
        let test = setup();
        let trader = fund_trader(&test, 5_000 * PRECISION);

        test.market.deposit_cross_margin(&trader, &(1_000 * PRECISION));

        // Open $500 cross position
        test.market.open_position_cross(
            &trader,
            &Symbol::new(&test.env, "XLM"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
        );

        let fee_info = test.market.get_trader_fee_info(&trader);
        assert_eq!(fee_info.volume_14d, 500 * PRECISION);
    }
}
