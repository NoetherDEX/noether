//! # Vault Contract (GLP Liquidity Pool)
//!
//! Manages the liquidity pool that acts as counterparty to all trades.
//!
//! ## Core Concepts
//!
//! **GLP (Global Liquidity Provider) Token:**
//! - Represents proportional ownership of the liquidity pool
//! - Price fluctuates based on pool performance
//! - LPs profit when traders lose, and vice versa
//!
//! **Assets Under Management (AUM):**
//! ```
//! AUM = Total USDC Deposited - Unrealized Trader PnL + Collected Fees
//! ```
//!
//! **GLP Price:**
//! ```
//! GLP Price = AUM / Total GLP Supply
//! ```
//!
//! ## Settlement Architecture
//!
//! The Vault and Market contracts work together for PnL settlement:
//!
//! **When trader WINS (positive PnL):**
//! - Vault transfers profit to Market (Vault can transfer its own tokens)
//! - Market then pays trader: collateral + profit
//!
//! **When trader LOSES (negative PnL):**
//! - Market pays trader the reduced amount (collateral - loss)
//! - Market transfers the loss to Vault via `receive_loss()`
//! - Vault just updates accounting in `settle_pnl()` for losses
//!
//! This design respects Soroban's authorization model where contracts
//! can only transfer their OWN tokens, not tokens from other contracts.

#![no_std]

use soroban_sdk::{contract, contractimpl, token, Address, Env, Symbol};
use noether_common::{
    NoetherError, PoolInfo, BASIS_POINTS,
    calculate_glp_for_deposit, calculate_usdc_for_withdrawal, calculate_glp_price,
};

mod storage;
mod glp;

use storage::*;

// ═══════════════════════════════════════════════════════════════════════════
// Contract Definition
// ═══════════════════════════════════════════════════════════════════════════

#[contract]
pub struct VaultContract;

#[contractimpl]
impl VaultContract {
    // ═══════════════════════════════════════════════════════════════════════
    // Initialization
    // ═══════════════════════════════════════════════════════════════════════

    /// Initialize the vault with configuration.
    ///
    /// # Arguments
    /// * `admin` - Admin address for configuration
    /// * `usdc_token` - USDC token contract address
    /// * `market_contract` - Market contract address (for settlement authorization)
    /// * `deposit_fee_bps` - Fee on deposits in basis points (e.g., 30 = 0.3%)
    /// * `withdraw_fee_bps` - Fee on withdrawals in basis points
    pub fn initialize(
        env: Env,
        admin: Address,
        usdc_token: Address,
        market_contract: Address,
        deposit_fee_bps: u32,
        withdraw_fee_bps: u32,
    ) -> Result<(), NoetherError> {
        if is_initialized(&env) {
            return Err(NoetherError::AlreadyInitialized);
        }

        admin.require_auth();

        // Validate fee parameters
        if deposit_fee_bps > 1000 || withdraw_fee_bps > 1000 {
            return Err(NoetherError::InvalidParameter);
        }

        // Store configuration
        set_admin(&env, &admin);
        set_usdc_token(&env, &usdc_token);
        set_market_contract(&env, &market_contract);
        set_deposit_fee_bps(&env, deposit_fee_bps);
        set_withdraw_fee_bps(&env, withdraw_fee_bps);

        // Initialize pool state
        set_total_usdc(&env, 0);
        set_total_glp(&env, 0);
        set_unrealized_pnl(&env, 0);
        set_total_fees(&env, 0);
        set_initialized(&env, true);
        set_paused(&env, false);

        // Extend storage TTL
        extend_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "initialized"),),
            (admin, market_contract, usdc_token),
        );

        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Liquidity Provider Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Deposit USDC and receive GLP tokens.
    ///
    /// # Arguments
    /// * `depositor` - Address depositing USDC
    /// * `usdc_amount` - Amount of USDC to deposit (7 decimals)
    ///
    /// # Returns
    /// Amount of GLP tokens minted
    ///
    /// # Formula
    /// ```
    /// glp_minted = usdc_amount * total_glp / aum  (or 1:1 if first deposit)
    /// ```
    pub fn deposit(env: Env, depositor: Address, usdc_amount: i128) -> Result<i128, NoetherError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;

        if usdc_amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        // Require depositor authorization
        depositor.require_auth();

        // Calculate fee
        let fee_bps = get_deposit_fee_bps(&env);
        let fee = usdc_amount * (fee_bps as i128) / (BASIS_POINTS as i128);
        let net_amount = usdc_amount - fee;

        // Get current pool state
        let total_glp = get_total_glp(&env);
        let aum = Self::calculate_aum_internal(&env);

        // Calculate GLP to mint
        let glp_to_mint = calculate_glp_for_deposit(net_amount, total_glp, aum)?;

        if glp_to_mint <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        // Transfer USDC from depositor to vault
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&depositor, &env.current_contract_address(), &usdc_amount);

        // Update pool state
        set_total_usdc(&env, get_total_usdc(&env) + usdc_amount);
        set_total_fees(&env, get_total_fees(&env) + fee);

        // Mint GLP to depositor
        glp::mint(&env, &depositor, glp_to_mint);

        // Emit event
        env.events().publish(
            (Symbol::new(&env, "deposit"),),
            (depositor.clone(), usdc_amount, glp_to_mint, fee),
        );

        extend_instance_ttl(&env);

        Ok(glp_to_mint)
    }

    /// Withdraw USDC by burning GLP tokens.
    ///
    /// # Arguments
    /// * `withdrawer` - Address withdrawing
    /// * `glp_amount` - Amount of GLP tokens to burn
    ///
    /// # Returns
    /// Amount of USDC returned
    ///
    /// # Formula
    /// ```
    /// usdc_returned = glp_amount * aum / total_glp - withdrawal_fee
    /// ```
    pub fn withdraw(env: Env, withdrawer: Address, glp_amount: i128) -> Result<i128, NoetherError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;

        if glp_amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        withdrawer.require_auth();

        // Check GLP balance
        let glp_balance = glp::balance(&env, &withdrawer);
        if glp_balance < glp_amount {
            return Err(NoetherError::InsufficientGlpBalance);
        }

        // Get current pool state
        let total_glp = get_total_glp(&env);
        let aum = Self::calculate_aum_internal(&env);

        // Calculate USDC to return
        let gross_usdc = calculate_usdc_for_withdrawal(glp_amount, total_glp, aum)?;

        // Calculate fee
        let fee_bps = get_withdraw_fee_bps(&env);
        let fee = gross_usdc * (fee_bps as i128) / (BASIS_POINTS as i128);
        let net_usdc = gross_usdc - fee;

        if net_usdc <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        // Check liquidity (actual token balance in vault)
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        let vault_balance = token_client.balance(&env.current_contract_address());

        if net_usdc > vault_balance {
            return Err(NoetherError::InsufficientLiquidity);
        }

        // Burn GLP from withdrawer
        glp::burn(&env, &withdrawer, glp_amount);

        // Update pool state
        set_total_usdc(&env, get_total_usdc(&env) - gross_usdc);
        set_total_fees(&env, get_total_fees(&env) + fee);

        // Transfer USDC to withdrawer
        token_client.transfer(&env.current_contract_address(), &withdrawer, &net_usdc);

        // Emit event
        env.events().publish(
            (Symbol::new(&env, "withdraw"),),
            (withdrawer.clone(), glp_amount, net_usdc, fee),
        );

        extend_instance_ttl(&env);

        Ok(net_usdc)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Market Contract Interface - Settlement Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Settle trader PnL with the vault.
    /// Called by the Market contract when positions are closed.
    ///
    /// # Arguments
    /// * `pnl` - Profit/loss amount (positive = trader won, negative = trader lost)
    ///
    /// # Settlement Logic
    ///
    /// **Trader WON (pnl > 0):**
    /// - Vault transfers profit amount to Market contract
    /// - Market then pays trader: collateral + profit
    /// - Vault's total_usdc decreases by pnl
    ///
    /// **Trader LOST (pnl < 0):**
    /// - Only update accounting here (Vault cannot pull from Market)
    /// - Market must call `receive_loss()` separately to transfer the loss
    /// - This respects Soroban's auth model: contracts can only spend own tokens
    ///
    /// **Break-even (pnl = 0):**
    /// - No transfers needed, just emit event
    pub fn settle_pnl(env: Env, pnl: i128) -> Result<(), NoetherError> {
        require_initialized(&env)?;

        // Only market contract can call this
        let market_contract = get_market_contract(&env);
        market_contract.require_auth();

        if pnl > 0 {
            // Trader WON - Vault must pay profit to Market
            let total_usdc = get_total_usdc(&env);

            // Check we have enough liquidity
            if pnl > total_usdc {
                return Err(NoetherError::InsufficientLiquidity);
            }

            // Verify actual token balance
            let usdc_token = get_usdc_token(&env);
            let token_client = token::Client::new(&env, &usdc_token);
            let vault_balance = token_client.balance(&env.current_contract_address());

            if pnl > vault_balance {
                return Err(NoetherError::InsufficientLiquidity);
            }

            // Transfer profit from Vault to Market
            token_client.transfer(&env.current_contract_address(), &market_contract, &pnl);

            // Update accounting
            set_total_usdc(&env, total_usdc - pnl);

        } else if pnl < 0 {
            // Trader LOST - Just update accounting
            // The Market will call receive_loss() to transfer the actual funds
            // We don't transfer here because Vault cannot pull tokens from Market
            let loss = -pnl;
            let total_usdc = get_total_usdc(&env);
            set_total_usdc(&env, total_usdc + loss);
        }
        // If pnl == 0, no action needed

        // Emit event
        env.events().publish(
            (Symbol::new(&env, "pnl_settled"),),
            (pnl,),
        );

        extend_instance_ttl(&env);

        Ok(())
    }

    /// Receive loss payment from Market contract.
    /// Called by Market after settle_pnl() when trader loses.
    ///
    /// # Arguments
    /// * `amount` - The loss amount being transferred from Market to Vault
    ///
    /// # Flow
    /// 1. Market calls settle_pnl(negative_pnl) - updates accounting
    /// 2. Market transfers loss amount to Vault
    /// 3. Market calls receive_loss(amount) - Vault verifies receipt
    ///
    /// This function is optional but recommended for verification.
    /// The accounting was already updated in settle_pnl().
    pub fn receive_loss(env: Env, amount: i128) -> Result<(), NoetherError> {
        require_initialized(&env)?;

        if amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        // Only market contract can call this
        let market_contract = get_market_contract(&env);
        market_contract.require_auth();

        // Emit event for tracking (accounting already updated in settle_pnl)
        env.events().publish(
            (Symbol::new(&env, "loss_received"),),
            (amount,),
        );

        Ok(())
    }

    /// Update unrealized PnL tracking.
    /// Called by Market contract to keep track of open position PnL.
    ///
    /// This affects AUM calculation and thus GLP price.
    /// Positive unrealized PnL = traders are winning = lower AUM
    /// Negative unrealized PnL = traders are losing = higher AUM
    pub fn update_unrealized_pnl(env: Env, new_pnl: i128) -> Result<(), NoetherError> {
        require_initialized(&env)?;

        let market_contract = get_market_contract(&env);
        market_contract.require_auth();

        let old_pnl = get_unrealized_pnl(&env);
        set_unrealized_pnl(&env, new_pnl);

        env.events().publish(
            (Symbol::new(&env, "unrealized_pnl_updated"),),
            (old_pnl, new_pnl),
        );

        Ok(())
    }

    /// Reserve USDC for a position being opened.
    /// Called when a trader opens a position to ensure liquidity exists.
    ///
    /// # Arguments
    /// * `amount` - Maximum potential payout needed for this position
    ///
    /// This is a check-only function - no actual fund movement.
    pub fn reserve_for_position(env: Env, amount: i128) -> Result<(), NoetherError> {
        require_initialized(&env)?;

        if amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        let market_contract = get_market_contract(&env);
        market_contract.require_auth();

        // Check we have enough liquidity to potentially pay out
        let total_usdc = get_total_usdc(&env);
        if amount > total_usdc {
            return Err(NoetherError::InsufficientLiquidity);
        }

        // Verify actual token balance
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        let vault_balance = token_client.balance(&env.current_contract_address());

        if amount > vault_balance {
            return Err(NoetherError::InsufficientLiquidity);
        }

        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // View Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Get current pool information.
    pub fn get_pool_info(env: Env) -> Result<PoolInfo, NoetherError> {
        require_initialized(&env)?;

        Ok(PoolInfo {
            total_usdc: get_total_usdc(&env),
            total_glp: get_total_glp(&env),
            aum: Self::calculate_aum_internal(&env),
            unrealized_pnl: get_unrealized_pnl(&env),
            total_fees: get_total_fees(&env),
        })
    }

    /// Get current GLP price in USDC.
    /// Returns price with 7 decimals (1.0 = 10_000_000).
    pub fn get_glp_price(env: Env) -> Result<i128, NoetherError> {
        require_initialized(&env)?;

        let total_glp = get_total_glp(&env);
        let aum = Self::calculate_aum_internal(&env);

        calculate_glp_price(total_glp, aum)
    }

    /// Get GLP balance for an address.
    pub fn get_glp_balance(env: Env, user: Address) -> i128 {
        glp::balance(&env, &user)
    }

    /// Get total GLP supply.
    pub fn get_total_glp(env: Env) -> i128 {
        get_total_glp(&env)
    }

    /// Get total USDC in pool (accounting value).
    pub fn get_total_usdc(env: Env) -> i128 {
        get_total_usdc(&env)
    }

    /// Get actual USDC token balance held by vault.
    pub fn get_usdc_balance(env: Env) -> Result<i128, NoetherError> {
        require_initialized(&env)?;

        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        Ok(token_client.balance(&env.current_contract_address()))
    }

    /// Calculate current AUM.
    pub fn get_aum(env: Env) -> Result<i128, NoetherError> {
        require_initialized(&env)?;
        Ok(Self::calculate_aum_internal(&env))
    }

    /// Get USDC token address.
    pub fn get_usdc_token(env: Env) -> Result<Address, NoetherError> {
        require_initialized(&env)?;
        Ok(get_usdc_token(&env))
    }

    /// Get market contract address.
    pub fn get_market_contract(env: Env) -> Result<Address, NoetherError> {
        require_initialized(&env)?;
        Ok(get_market_contract(&env))
    }

    /// Get deposit fee in basis points.
    pub fn get_deposit_fee(env: Env) -> u32 {
        get_deposit_fee_bps(&env)
    }

    /// Get withdrawal fee in basis points.
    pub fn get_withdraw_fee(env: Env) -> u32 {
        get_withdraw_fee_bps(&env)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Admin Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Update market contract address.
    /// Use with caution - this changes which contract can settle trades.
    pub fn set_market_contract(env: Env, new_market: Address) -> Result<(), NoetherError> {
        require_admin(&env)?;

        let old_market = get_market_contract(&env);
        set_market_contract(&env, &new_market);

        env.events().publish(
            (Symbol::new(&env, "market_updated"),),
            (old_market, new_market),
        );

        Ok(())
    }

    /// Update deposit fee.
    pub fn set_deposit_fee(env: Env, fee_bps: u32) -> Result<(), NoetherError> {
        require_admin(&env)?;
        if fee_bps > 1000 {
            // Max 10% fee
            return Err(NoetherError::InvalidParameter);
        }
        set_deposit_fee_bps(&env, fee_bps);

        env.events().publish(
            (Symbol::new(&env, "deposit_fee_updated"),),
            (fee_bps,),
        );

        Ok(())
    }

    /// Update withdrawal fee.
    pub fn set_withdraw_fee(env: Env, fee_bps: u32) -> Result<(), NoetherError> {
        require_admin(&env)?;
        if fee_bps > 1000 {
            return Err(NoetherError::InvalidParameter);
        }
        set_withdraw_fee_bps(&env, fee_bps);

        env.events().publish(
            (Symbol::new(&env, "withdraw_fee_updated"),),
            (fee_bps,),
        );

        Ok(())
    }

    /// Pause the vault (emergency).
    /// When paused: deposits and withdrawals are blocked.
    /// Settlements still work to allow position closures.
    pub fn pause(env: Env) -> Result<(), NoetherError> {
        require_admin(&env)?;
        set_paused(&env, true);

        env.events().publish(
            (Symbol::new(&env, "paused"),),
            (),
        );

        Ok(())
    }

    /// Unpause the vault.
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
    /// Requires both current admin and new admin authorization.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), NoetherError> {
        require_admin(&env)?;
        new_admin.require_auth();

        let old_admin = get_admin(&env);
        set_admin(&env, &new_admin);

        env.events().publish(
            (Symbol::new(&env, "admin_updated"),),
            (old_admin, new_admin),
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

    /// Emergency withdraw for admin.
    /// Only callable when paused. Use for emergency recovery only.
    pub fn emergency_withdraw(env: Env, amount: i128, recipient: Address) -> Result<(), NoetherError> {
        require_admin(&env)?;

        // Must be paused for emergency operations
        if !get_paused(&env) {
            return Err(NoetherError::NotPaused);
        }

        if amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        let vault_balance = token_client.balance(&env.current_contract_address());

        if amount > vault_balance {
            return Err(NoetherError::InsufficientLiquidity);
        }

        token_client.transfer(&env.current_contract_address(), &recipient, &amount);

        env.events().publish(
            (Symbol::new(&env, "emergency_withdraw"),),
            (amount, recipient),
        );

        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Internal Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Calculate AUM (Assets Under Management).
    ///
    /// # Formula
    /// ```
    /// AUM = Total USDC + Fees - Unrealized PnL
    /// ```
    ///
    /// Note: When traders are winning (positive unrealized PnL),
    /// AUM decreases because the pool owes them money.
    fn calculate_aum_internal(env: &Env) -> i128 {
        let total_usdc = get_total_usdc(env);
        let total_fees = get_total_fees(env);
        let unrealized_pnl = get_unrealized_pnl(env);

        // AUM = deposits + fees - what we owe traders
        // If unrealized_pnl is positive (traders winning), AUM decreases
        // If unrealized_pnl is negative (traders losing), AUM increases
        let aum = total_usdc + total_fees - unrealized_pnl;

        // AUM should never be negative
        if aum < 0 {
            0
        } else {
            aum
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    // Tests will be added in integration test file
    // as they require token contract setup
}
