//! # Vault Contract (NOE Liquidity Pool)
//!
//! Manages the liquidity pool that acts as counterparty to all trades.
//!
//! ## Core Concepts
//!
//! **NOE (Noether LP) Token:**
//! - Represents proportional ownership of the liquidity pool
//! - Real Stellar Classic Asset + SAC wrapper (visible in wallets, tradeable on SDEX)
//! - Price fluctuates based on pool performance
//! - LPs profit when traders lose, and vice versa
//!
//! **Assets Under Management (AUM):**
//! ```
//! AUM = Total USDC Deposited - Unrealized Trader PnL + Collected Fees
//! ```
//!
//! **NOE Price:**
//! ```
//! NOE Price = AUM / Circulating NOE Supply
//! ```
//!
//! ## Pre-mint + Transfer Model
//!
//! NOE tokens are pre-minted to the vault. On deposit/withdraw:
//! - Deposit: Vault transfers NOE to user
//! - Withdraw: User transfers NOE back to vault
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

use soroban_sdk::{contract, contractimpl, token, Address, BytesN, Env, Symbol};
use noether_common::{
    NoetherError, PoolInfo, BASIS_POINTS, RESERVE_CAP_BPS,
    calculate_glp_for_deposit, calculate_usdc_for_withdrawal, calculate_glp_price,
};

mod storage;
mod noe;

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
    /// * `noe_token` - NOE token contract address (SAC-wrapped classic asset)
    /// * `market_contract` - Market contract address (for settlement authorization)
    /// * `deposit_fee_bps` - Fee on deposits in basis points (e.g., 30 = 0.3%)
    /// * `withdraw_fee_bps` - Fee on withdrawals in basis points
    pub fn initialize(
        env: Env,
        admin: Address,
        usdc_token: Address,
        noe_token: Address,
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
        set_noe_token(&env, &noe_token);
        set_market_contract(&env, &market_contract);
        set_deposit_fee_bps(&env, deposit_fee_bps);
        set_withdraw_fee_bps(&env, withdraw_fee_bps);

        // Initialize pool state
        set_total_usdc(&env, 0);
        set_total_noe_circulating(&env, 0);
        set_unrealized_pnl(&env, 0);
        set_total_fees(&env, 0);
        set_initialized(&env, true);
        set_paused(&env, false);

        // Extend storage TTL
        extend_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "initialized"),),
            (admin, market_contract, usdc_token, noe_token),
        );

        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Liquidity Provider Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Deposit USDC and receive NOE tokens.
    ///
    /// # Arguments
    /// * `depositor` - Address depositing USDC
    /// * `usdc_amount` - Amount of USDC to deposit (7 decimals)
    ///
    /// # Returns
    /// Amount of NOE tokens received
    ///
    /// # Formula
    /// ```
    /// noe_amount = usdc_amount * circulating_noe / aum  (or 1:1 if first deposit)
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
        let circulating_noe = get_total_noe_circulating(&env);
        let aum = Self::calculate_aum_internal(&env);

        // Calculate NOE to transfer to user
        let noe_amount = calculate_glp_for_deposit(net_amount, circulating_noe, aum)?;

        if noe_amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        // Check vault has enough NOE to transfer
        let vault_noe = noe::vault_balance(&env);
        if noe_amount > vault_noe {
            return Err(NoetherError::InsufficientLiquidity);
        }

        // Transfer USDC from depositor to vault
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&depositor, &env.current_contract_address(), &usdc_amount);

        // Update pool state
        set_total_usdc(&env, get_total_usdc(&env) + usdc_amount);
        set_total_fees(&env, get_total_fees(&env) + fee);

        // Transfer NOE to depositor
        noe::transfer_to_user(&env, &depositor, noe_amount);

        // Emit event
        env.events().publish(
            (Symbol::new(&env, "deposit"),),
            (depositor.clone(), usdc_amount, noe_amount, fee),
        );

        extend_instance_ttl(&env);

        Ok(noe_amount)
    }

    /// Withdraw USDC by returning NOE tokens.
    ///
    /// # Arguments
    /// * `withdrawer` - Address withdrawing
    /// * `noe_amount` - Amount of NOE tokens to return
    ///
    /// # Returns
    /// Amount of USDC returned
    ///
    /// # Formula
    /// ```
    /// usdc_returned = noe_amount * aum / circulating_noe - withdrawal_fee
    /// ```
    ///
    /// # Note
    /// User must approve the vault to spend their NOE tokens before calling.
    pub fn withdraw(env: Env, withdrawer: Address, noe_amount: i128) -> Result<i128, NoetherError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;

        if noe_amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        withdrawer.require_auth();

        // Check NOE balance
        let noe_balance = noe::balance(&env, &withdrawer);
        if noe_balance < noe_amount {
            return Err(NoetherError::InsufficientBalance);
        }

        // Get current pool state
        let circulating_noe = get_total_noe_circulating(&env);
        let aum = Self::calculate_aum_internal(&env);

        // Calculate USDC to return
        let gross_usdc = calculate_usdc_for_withdrawal(noe_amount, circulating_noe, aum)?;

        // Calculate fee
        let fee_bps = get_withdraw_fee_bps(&env);
        let fee = gross_usdc * (fee_bps as i128) / (BASIS_POINTS as i128);
        let net_usdc = gross_usdc - fee;

        if net_usdc <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        // Check USDC liquidity (actual token balance in vault)
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        let vault_balance = token_client.balance(&env.current_contract_address());

        if net_usdc > vault_balance {
            return Err(NoetherError::InsufficientLiquidity);
        }

        // Transfer NOE from withdrawer back to vault
        noe::transfer_from_user(&env, &withdrawer, noe_amount);

        // Update pool state
        set_total_usdc(&env, get_total_usdc(&env) - gross_usdc);
        set_total_fees(&env, get_total_fees(&env) + fee);

        // Transfer USDC to withdrawer
        token_client.transfer(&env.current_contract_address(), &withdrawer, &net_usdc);

        // Emit event
        env.events().publish(
            (Symbol::new(&env, "withdraw"),),
            (withdrawer.clone(), noe_amount, net_usdc, fee),
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
    /// Settle a position's PnL with the pool. Returns the amount actually
    /// settled to the market: for a winner this is the profit *paid* (which may
    /// be capped below `pnl` when the pool is undercollateralised); for a loss
    /// it is `pnl` unchanged. The caller pays the trader from this figure.
    ///
    /// A winning close MUST NEVER revert (V-3): if the pool can't cover the full
    /// profit, it pays what it has, records the remainder as a `Shortfall`
    /// liability (reconciled by the insurance buffer in T3), and emits an event.
    pub fn settle_pnl(env: Env, pnl: i128) -> Result<i128, NoetherError> {
        require_initialized(&env)?;

        // Only market contract can call this
        let market_contract = get_market_contract(&env);
        market_contract.require_auth();

        let settled = if pnl > 0 {
            // Trader WON - pay what the pool can actually cover.
            let total_usdc = get_total_usdc(&env);
            let usdc_token = get_usdc_token(&env);
            let token_client = token::Client::new(&env, &usdc_token);
            let vault_balance = token_client.balance(&env.current_contract_address());

            // Available = the lesser of LP accounting and the real token balance,
            // floored at zero.
            let mut available = if total_usdc < vault_balance { total_usdc } else { vault_balance };
            if available < 0 {
                available = 0;
            }
            let paid = if pnl > available { available } else { pnl };

            if paid > 0 {
                token_client.transfer(&env.current_contract_address(), &market_contract, &paid);
                set_total_usdc(&env, total_usdc - paid);
            }
            if paid < pnl {
                // Record the unpaid remainder as a protocol liability.
                add_shortfall(&env, pnl - paid);
                env.events().publish(
                    (Symbol::new(&env, "pnl_shortfall"),),
                    (pnl, paid, pnl - paid),
                );
            }
            paid
        } else if pnl < 0 {
            // Trader LOST - Just update accounting. The Market transfers the
            // actual funds via receive_loss() (Vault cannot pull from Market).
            let loss = -pnl;
            let total_usdc = get_total_usdc(&env);
            set_total_usdc(&env, total_usdc + loss);
            pnl
        } else {
            0
        };

        env.events().publish(
            (Symbol::new(&env, "pnl_settled"),),
            (pnl, settled),
        );

        extend_instance_ttl(&env);

        Ok(settled)
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
    /// Reserve `amount` of committed payout for a position being opened (M-4).
    /// Accumulates a running total so concurrent opens can't collectively
    /// over-commit the pool: the aggregate reserve must stay within
    /// `RESERVE_CAP_BPS` of AUM, otherwise the open is rejected. Released on
    /// close/liquidate via `release_reservation`. Market-gated.
    pub fn reserve_for_position(env: Env, amount: i128) -> Result<(), NoetherError> {
        require_initialized(&env)?;

        if amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        let market_contract = get_market_contract(&env);
        market_contract.require_auth();

        // Aggregate reserve must stay within RESERVE_CAP_BPS of AUM.
        let aum = Self::calculate_aum_internal(&env);
        let cap = aum * (RESERVE_CAP_BPS as i128) / (BASIS_POINTS as i128);
        let new_reserved = get_total_reserved(&env)
            .checked_add(amount)
            .ok_or(NoetherError::Overflow)?;
        if new_reserved > cap {
            return Err(NoetherError::InsufficientLiquidity);
        }

        set_total_reserved(&env, new_reserved);
        Ok(())
    }

    /// Release a previously-reserved payout when a position closes/liquidates.
    /// Saturating + never reverts, so it can't block a close (V-3). Market-gated.
    pub fn release_reservation(env: Env, amount: i128) -> Result<(), NoetherError> {
        require_initialized(&env)?;
        let market_contract = get_market_contract(&env);
        market_contract.require_auth();

        if amount > 0 {
            let reserved = get_total_reserved(&env);
            let next = if reserved > amount { reserved - amount } else { 0 };
            set_total_reserved(&env, next);
        }
        Ok(())
    }

    /// Aggregate committed payout currently reserved against the pool (view).
    pub fn get_total_reserved(env: Env) -> i128 {
        get_total_reserved(&env)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // View Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Get current pool information.
    pub fn get_pool_info(env: Env) -> Result<PoolInfo, NoetherError> {
        require_initialized(&env)?;

        Ok(PoolInfo {
            total_usdc: get_total_usdc(&env),
            total_glp: get_total_noe_circulating(&env),
            aum: Self::calculate_aum_internal(&env),
            unrealized_pnl: get_unrealized_pnl(&env),
            total_fees: get_total_fees(&env),
        })
    }

    /// Get current NOE price in USDC.
    /// Returns price with 7 decimals (1.0 = 10_000_000).
    pub fn get_noe_price(env: Env) -> Result<i128, NoetherError> {
        require_initialized(&env)?;

        let circulating_noe = get_total_noe_circulating(&env);
        let aum = Self::calculate_aum_internal(&env);

        calculate_glp_price(circulating_noe, aum)
    }

    /// Get NOE balance for an address (queries token contract).
    pub fn get_noe_balance(env: Env, user: Address) -> i128 {
        noe::balance(&env, &user)
    }

    /// Get total circulating NOE (held by users).
    pub fn get_total_noe(env: Env) -> i128 {
        get_total_noe_circulating(&env)
    }

    /// Get NOE token address.
    pub fn get_noe_token(env: Env) -> Result<Address, NoetherError> {
        require_initialized(&env)?;
        Ok(get_noe_token(&env))
    }

    /// Get total USDC in pool (accounting value).
    pub fn get_total_usdc(env: Env) -> i128 {
        get_total_usdc(&env)
    }

    /// Cumulative unpaid winner profit (a protocol liability the insurance
    /// buffer reconciles in T3). Non-zero means the pool was undercollateralised
    /// when a winner closed (V-3).
    pub fn get_shortfall(env: Env) -> i128 {
        get_shortfall(&env)
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

    /// Admin-gated WASM upgrade. Swaps the contract code in place; storage is
    /// preserved (SEC-2). The new WASM must already be installed on-chain.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), NoetherError> {
        require_admin(&env)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash);
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
            return Err(NoetherError::InvalidParameter);
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
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::token::StellarAssetClient;
    use soroban_sdk::{Address, Env};

    // 7-decimal unit, matching noether_common::PRECISION.
    const UNIT: i128 = 10_000_000;

    /// Vault funded with $100 and zero fees → AUM == real balance == $100.
    fn setup_funded() -> (Env, VaultContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let market = Address::generate(&env); // stand-in for the market contract
        let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let noe = env.register_stellar_asset_contract_v2(admin.clone()).address();

        let vault_id = env.register_contract(None, VaultContract);
        let vault = VaultContractClient::new(&env, &vault_id);
        vault.initialize(&admin, &usdc, &noe, &market, &0, &0);

        StellarAssetClient::new(&env, &noe).mint(&vault_id, &(1_000_000_000 * UNIT));
        StellarAssetClient::new(&env, &usdc).mint(&admin, &(100 * UNIT));
        vault.deposit(&admin, &(100 * UNIT));
        (env, vault)
    }

    // V-3: a winning close must never revert. When the pool can't cover the full
    // profit it pays what it has and records the remainder as a shortfall.
    #[test]
    fn winning_close_caps_payout_and_records_shortfall() {
        let (_env, vault) = setup_funded();
        let funded = vault.get_total_usdc();
        assert_eq!(funded, 100 * UNIT);

        let owed = funded + 500 * UNIT;
        let settled = vault.settle_pnl(&owed);

        assert_eq!(settled, funded);
        assert_eq!(vault.get_total_usdc(), 0);
        assert_eq!(vault.get_shortfall(), owed - funded);
    }

    // M-4: reservations accumulate, the aggregate is capped at RESERVE_CAP_BPS
    // (70%) of AUM, and release frees capacity.
    #[test]
    fn reservation_accumulates_caps_and_releases() {
        let (_env, vault) = setup_funded(); // AUM = $100 → cap = $70

        vault.reserve_for_position(&(50 * UNIT));
        assert_eq!(vault.get_total_reserved(), 50 * UNIT);

        // 50 + 30 = 80 > 70 cap → rejected.
        let over = vault.try_reserve_for_position(&(30 * UNIT));
        assert!(matches!(over, Err(Ok(NoetherError::InsufficientLiquidity))));

        // 50 + 20 = 70 == cap → allowed.
        vault.reserve_for_position(&(20 * UNIT));
        assert_eq!(vault.get_total_reserved(), 70 * UNIT);

        // Release frees capacity for new opens.
        vault.release_reservation(&(40 * UNIT));
        assert_eq!(vault.get_total_reserved(), 30 * UNIT);
        vault.reserve_for_position(&(40 * UNIT)); // back to the 70 cap
        let over2 = vault.try_reserve_for_position(&UNIT);
        assert!(matches!(over2, Err(Ok(NoetherError::InsufficientLiquidity))));
    }

    // Deposit → withdraw round-trip returns the principal when fees are zero.
    #[test]
    fn deposit_withdraw_round_trip() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let market = Address::generate(&env);
        let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let noe = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let vault_id = env.register_contract(None, VaultContract);
        let vault = VaultContractClient::new(&env, &vault_id);
        vault.initialize(&admin, &usdc, &noe, &market, &0, &0);
        StellarAssetClient::new(&env, &noe).mint(&vault_id, &(1_000_000_000 * UNIT));

        let lp = Address::generate(&env);
        StellarAssetClient::new(&env, &usdc).mint(&lp, &(100 * UNIT));

        let shares = vault.deposit(&lp, &(100 * UNIT));
        assert!(shares > 0);
        assert_eq!(vault.get_noe_balance(&lp), shares);

        // Withdraw pulls NOE via transfer_from, so the LP approves the vault
        // first (the real flow's "approve NOE" step).
        soroban_sdk::token::Client::new(&env, &noe).approve(
            &lp,
            &vault_id,
            &shares,
            &(env.ledger().sequence() + 1000),
        );
        let usdc_back = vault.withdraw(&lp, &shares);
        assert_eq!(usdc_back, 100 * UNIT);
    }

    // V-2: a trader loss raises NOE price (LPs gain); a win lowers it.
    #[test]
    fn noe_price_tracks_settled_pnl() {
        let (_env, vault) = setup_funded();
        let p0 = vault.get_noe_price();

        vault.settle_pnl(&(-10 * UNIT)); // traders lose $10 → pool gains
        let p_loss = vault.get_noe_price();
        assert!(p_loss > p0);

        vault.settle_pnl(&(5 * UNIT)); // traders win $5 → pool pays out
        let p_win = vault.get_noe_price();
        assert!(p_win < p_loss);
    }

    // Money-moving entry points are market-gated: a caller without the market's
    // authorization is rejected.
    #[test]
    fn settle_pnl_requires_market_auth() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let market = Address::generate(&env);
        let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let noe = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let vault_id = env.register_contract(None, VaultContract);
        let vault = VaultContractClient::new(&env, &vault_id);
        vault.initialize(&admin, &usdc, &noe, &market, &0, &0);

        // Require real authorization (none supplied) — the market-gated call fails.
        env.set_auths(&[]);
        assert!(vault.try_settle_pnl(&(10 * UNIT)).is_err());
    }
}
