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
//! ## Functions
//! - `deposit`: LPs deposit USDC, receive GLP tokens
//! - `withdraw`: LPs burn GLP, receive USDC
//! - `settle_pnl`: Called by Market contract to settle trader profits/losses

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
            (depositor.clone(), usdc_amount, glp_to_mint),
        );

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

        // Check liquidity
        let total_usdc = get_total_usdc(&env);
        if net_usdc > total_usdc {
            return Err(NoetherError::InsufficientLiquidity);
        }

        // Burn GLP from withdrawer
        glp::burn(&env, &withdrawer, glp_amount);

        // Update pool state
        set_total_usdc(&env, total_usdc - gross_usdc);
        set_total_fees(&env, get_total_fees(&env) + fee);

        // Transfer USDC to withdrawer
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&env.current_contract_address(), &withdrawer, &net_usdc);

        // Emit event
        env.events().publish(
            (Symbol::new(&env, "withdraw"),),
            (withdrawer.clone(), glp_amount, net_usdc),
        );

        Ok(net_usdc)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Market Contract Interface
    // ═══════════════════════════════════════════════════════════════════════

    /// Settle trader PnL with the vault.
    /// Called by the Market contract when positions are closed.
    ///
    /// # Arguments
    /// * `pnl` - Profit/loss amount (positive = trader won, negative = trader lost)
    ///
    /// # Logic
    /// - If trader won (positive PnL): vault pays out, reducing pool value
    /// - If trader lost (negative PnL): vault receives, increasing pool value
    ///
    /// This is the core mechanism where LPs take the opposite side of traders.
    pub fn settle_pnl(env: Env, pnl: i128) -> Result<(), NoetherError> {
        require_initialized(&env)?;

        // Only market contract can call this
        let market_contract = get_market_contract(&env);
        market_contract.require_auth();

        let total_usdc = get_total_usdc(&env);

        if pnl > 0 {
            // Trader won - vault pays out
            // Check we have enough liquidity
            if pnl > total_usdc {
                return Err(NoetherError::InsufficientLiquidity);
            }
            set_total_usdc(&env, total_usdc - pnl);
        } else {
            // Trader lost - vault receives
            set_total_usdc(&env, total_usdc + (-pnl));
        }

        // Emit event
        env.events().publish(
            (Symbol::new(&env, "pnl_settled"),),
            (pnl,),
        );

        Ok(())
    }

    /// Update unrealized PnL tracking.
    /// Called by Market contract to keep track of open position PnL.
    ///
    /// This affects AUM calculation and thus GLP price.
    pub fn update_unrealized_pnl(env: Env, new_pnl: i128) -> Result<(), NoetherError> {
        require_initialized(&env)?;

        let market_contract = get_market_contract(&env);
        market_contract.require_auth();

        set_unrealized_pnl(&env, new_pnl);

        Ok(())
    }

    /// Reserve USDC for a position being opened.
    /// Called when a trader opens a position.
    pub fn reserve_for_position(env: Env, amount: i128) -> Result<(), NoetherError> {
        require_initialized(&env)?;

        let market_contract = get_market_contract(&env);
        market_contract.require_auth();

        let total_usdc = get_total_usdc(&env);
        if amount > total_usdc {
            return Err(NoetherError::InsufficientLiquidity);
        }

        // We don't actually move funds, just track the reservation
        // The actual transfer happens on settlement

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

    /// Get total USDC in pool.
    pub fn get_total_usdc(env: Env) -> i128 {
        get_total_usdc(&env)
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

    // ═══════════════════════════════════════════════════════════════════════
    // Admin Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Update market contract address.
    pub fn set_market_contract(env: Env, new_market: Address) -> Result<(), NoetherError> {
        require_admin(&env)?;
        set_market_contract(&env, &new_market);
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
        Ok(())
    }

    /// Update withdrawal fee.
    pub fn set_withdraw_fee(env: Env, fee_bps: u32) -> Result<(), NoetherError> {
        require_admin(&env)?;
        if fee_bps > 1000 {
            return Err(NoetherError::InvalidParameter);
        }
        set_withdraw_fee_bps(&env, fee_bps);
        Ok(())
    }

    /// Pause the vault (emergency).
    pub fn pause(env: Env) -> Result<(), NoetherError> {
        require_admin(&env)?;
        set_paused(&env, true);
        Ok(())
    }

    /// Unpause the vault.
    pub fn unpause(env: Env) -> Result<(), NoetherError> {
        require_admin(&env)?;
        set_paused(&env, false);
        Ok(())
    }

    /// Transfer admin role.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), NoetherError> {
        require_admin(&env)?;
        new_admin.require_auth();
        set_admin(&env, &new_admin);
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
