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
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    // Integration tests in separate file due to complexity
}
