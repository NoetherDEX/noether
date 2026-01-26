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

        // Calculate and deduct trading fee
        let fee = calculate_trading_fee(size, config.trading_fee_bps);
        let net_collateral = collateral - fee;

        // Transfer collateral from trader to market contract
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&trader, &env.current_contract_address(), &collateral);

        // Generate position ID
        let position_id = next_position_id(&env);

        // Create position
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
            // Slippage exceeded - cancel the order
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

            env.events().publish(
                (Symbol::new(&env, "order_cancelled"),),
                (order_id, order.trader.clone(), Symbol::new(&env, "slippage_exceeded")),
            );

            return Err(NoetherError::SlippageExceeded);
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

        // Calculate trading fee
        let trading_fee = calculate_trading_fee(size, config.trading_fee_bps);

        // Total fees = trading fee + keeper fee
        let total_fees = trading_fee + keeper_fee;
        let net_collateral = order.collateral - total_fees;

        if net_collateral <= 0 {
            return Err(NoetherError::InsufficientCollateral);
        }

        // Generate position ID
        let position_id = next_position_id(env);

        // Create position
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
    // Integration tests in separate file due to complexity
}
