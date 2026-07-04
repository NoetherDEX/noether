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
    NoetherError, PoolInfo, BASIS_POINTS,
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

        // LP exits cannot pull liquidity out from under open positions:
        // what remains must still cover every committed payout (M-4)
        if vault_balance - net_usdc < get_reserved_payout(&env) {
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
    /// Returns the profit actually paid out. A winner's close can never
    /// hard-revert here: the payout is capped at what the pool holds and
    /// any unpaid remainder is recorded as shortfall (owed against the
    /// future insurance buffer). Losses are credited ONLY when the USDC
    /// actually arrives, via receive_loss.
    pub fn settle_pnl(env: Env, pnl: i128) -> Result<i128, NoetherError> {
        require_initialized(&env)?;

        // Only market contract can call this
        let market_contract = get_market_contract(&env);
        market_contract.require_auth();

        let mut paid: i128 = 0;
        if pnl > 0 {
            // Trader WON. Waterfall (P5-6): the insurance BUFFER pays first,
            // LP value (total_usdc) only for the remainder — this shields the
            // NOE price from winner payouts. Everything is still capped at the
            // vault's real USDC balance so a close can never hard-revert.
            let total_usdc = get_total_usdc(&env);
            let buffer = get_buffer_balance(&env);
            let usdc_token = get_usdc_token(&env);
            let token_client = token::Client::new(&env, &usdc_token);
            let vault_balance = token_client.balance(&env.current_contract_address());

            paid = pnl;
            let coverable = buffer + total_usdc;
            if paid > coverable {
                paid = coverable;
            }
            if paid > vault_balance {
                paid = vault_balance;
            }
            if paid < 0 {
                paid = 0;
            }

            if paid > 0 {
                token_client.transfer(&env.current_contract_address(), &market_contract, &paid);
                // Draw from the buffer first, then LP value.
                let from_buffer = if paid > buffer { buffer } else { paid };
                if from_buffer > 0 {
                    set_buffer_balance(&env, buffer - from_buffer);
                }
                let from_lp = paid - from_buffer;
                if from_lp > 0 {
                    set_total_usdc(&env, total_usdc - from_lp);
                }
            }
            if paid < pnl {
                let short = pnl - paid;
                set_shortfall(&env, get_shortfall(&env) + short);
                env.events().publish(
                    (Symbol::new(&env, "payout_shortfall"),),
                    (pnl, paid, short),
                );
            }
        }
        // pnl < 0: accounting credit happens in receive_loss when the
        // market's transfer actually lands (never credit unreceived funds)

        env.events().publish(
            (Symbol::new(&env, "pnl_settled"),),
            (pnl,),
        );

        extend_instance_ttl(&env);

        Ok(paid)
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

        // Credit exactly what was transferred — the market calls this
        // right after moving USDC (losses, funding) into the vault, so
        // accounting can never exceed real assets (V-3 tail)
        set_total_usdc(&env, get_total_usdc(&env) + amount);

        env.events().publish(
            (Symbol::new(&env, "loss_received"),),
            (amount,),
        );

        Ok(())
    }

    /// Market-pushed exposure sync: sets one asset's unrealized trader
    /// PnL (folded into total UnrealizedPnl, which prices NOE via AUM)
    /// and releases reservation for closed positions in the same call.
    /// Positive unrealized PnL = traders winning = lower AUM.
    pub fn sync_exposure(
        env: Env,
        asset: Symbol,
        asset_unrealized_pnl: i128,
        release: i128,
    ) -> Result<(), NoetherError> {
        require_initialized(&env)?;

        let market_contract = get_market_contract(&env);
        market_contract.require_auth();

        let old_asset = get_asset_unrealized_pnl(&env, &asset);
        set_asset_unrealized_pnl(&env, &asset, asset_unrealized_pnl);
        let total = get_unrealized_pnl(&env) - old_asset + asset_unrealized_pnl;
        set_unrealized_pnl(&env, total);

        if release > 0 {
            let reserved = get_reserved_payout(&env);
            set_reserved_payout(&env, if reserved > release { reserved - release } else { 0 });
        }

        env.events().publish(
            (Symbol::new(&env, "exposure_synced"), asset),
            (asset_unrealized_pnl, total, release),
        );

        Ok(())
    }

    /// Reserve the max potential payout for a position being opened.
    /// REAL reservation (M-4/V-3): committed payouts accumulate in
    /// ReservedPayout and are released on close/liquidation via
    /// sync_exposure. Rejects when the aggregate reservation would
    /// exceed reserve_cap_bps of AUM, or when the asset's per-side OI
    /// (passed by the market, which tracks it) would exceed that
    /// asset's cap — both #82 OpenInterestCapExceeded.
    pub fn reserve_for_position(
        env: Env,
        asset: Symbol,
        amount: i128,
        asset_side_oi_after: i128,
    ) -> Result<(), NoetherError> {
        require_initialized(&env)?;

        if amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        let market_contract = get_market_contract(&env);
        market_contract.require_auth();

        let aum = Self::calculate_aum_internal(&env);
        let reserved = get_reserved_payout(&env);

        let reserve_cap = aum * (get_reserve_cap_bps(&env) as i128) / (BASIS_POINTS as i128);
        if reserved + amount > reserve_cap {
            return Err(NoetherError::OpenInterestCapExceeded);
        }

        let asset_cap = aum * (get_asset_cap_bps(&env, &asset) as i128) / (BASIS_POINTS as i128);
        if asset_side_oi_after > asset_cap {
            return Err(NoetherError::OpenInterestCapExceeded);
        }

        // The pool must also physically hold what it already promised
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        let vault_balance = token_client.balance(&env.current_contract_address());
        if reserved + amount > vault_balance {
            return Err(NoetherError::InsufficientLiquidity);
        }

        set_reserved_payout(&env, reserved + amount);

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

    /// Seed the insurance buffer from an admin-funded USDC transfer (P5-6).
    /// The admin must have approved / holds the USDC; it is pulled in and
    /// credited to the protocol-owned buffer (NOT LP value).
    pub fn seed_buffer(env: Env, from: Address, amount: i128) -> Result<(), NoetherError> {
        require_initialized(&env)?;
        require_admin(&env)?;
        if amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }
        from.require_auth();
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(&from, &env.current_contract_address(), &amount);
        set_buffer_balance(&env, get_buffer_balance(&env) + amount);
        env.events().publish((Symbol::new(&env, "buffer_seeded"),), (amount,));
        Ok(())
    }

    /// Credit USDC the market just transferred into the buffer — liquidation
    /// penalties, protocol fee share, net trader losses (P5-6). Market-only,
    /// credited on receipt (the market transfers, then calls this).
    pub fn fund_buffer(env: Env, amount: i128) -> Result<(), NoetherError> {
        require_initialized(&env)?;
        let market_contract = get_market_contract(&env);
        market_contract.require_auth();
        if amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }
        set_buffer_balance(&env, get_buffer_balance(&env) + amount);
        env.events().publish((Symbol::new(&env, "buffer_funded"),), (amount,));
        Ok(())
    }

    /// Current insurance buffer balance.
    pub fn get_buffer_balance(env: Env) -> i128 {
        storage::get_buffer_balance(&env)
    }

    /// Set the aggregate reservation cap (bps of AUM). Admin only.
    pub fn set_reserve_cap(env: Env, bps: u32) -> Result<(), NoetherError> {
        require_admin(&env)?;
        if bps == 0 || bps > BASIS_POINTS {
            return Err(NoetherError::InvalidParameter);
        }
        storage::set_reserve_cap_bps(&env, bps);
        Ok(())
    }

    /// Set one asset's per-side OI cap (bps of AUM). Admin only.
    pub fn set_asset_cap(env: Env, asset: Symbol, bps: u32) -> Result<(), NoetherError> {
        require_admin(&env)?;
        if bps == 0 || bps > BASIS_POINTS {
            return Err(NoetherError::InvalidParameter);
        }
        storage::set_asset_cap_bps(&env, &asset, bps);
        Ok(())
    }

    /// Total committed max payouts for open positions.
    pub fn get_reserved_payout(env: Env) -> i128 {
        storage::get_reserved_payout(&env)
    }

    /// Cumulative winner profit the pool could not pay at close.
    pub fn get_shortfall(env: Env) -> i128 {
        storage::get_shortfall(&env)
    }

    /// One asset's unrealized trader PnL as last pushed by the market.
    pub fn get_asset_unrealized_pnl(env: Env, asset: Symbol) -> i128 {
        storage::get_asset_unrealized_pnl(&env, &asset)
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

    /// Swap the running WASM in place; LP balances and pool accounting
    /// are preserved across the upgrade.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), NoetherError> {
        require_admin(&env)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash);
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
    use soroban_sdk::{testutils::{Address as _, Ledger as _}, token::StellarAssetClient, Address, Env, Symbol};
    use noether_common::PRECISION;

    struct VaultTest {
        env: Env,
        vault_id: Address,
        vault: VaultContractClient<'static>,
        usdc: Address,
        noe: Address,
        market: Address,
        admin: Address,
        lp: Address,
    }

    fn setup(initial_deposit: i128) -> VaultTest {
        let env = Env::default();
        env.mock_all_auths();
        env.budget().reset_unlimited();
        env.ledger().set_timestamp(1_700_000_000);

        let admin = Address::generate(&env);
        let market = Address::generate(&env);
        let lp = Address::generate(&env);

        let usdc_sac = env.register_stellar_asset_contract_v2(admin.clone());
        let usdc = usdc_sac.address();
        let noe_sac = env.register_stellar_asset_contract_v2(admin.clone());
        let noe: Address = noe_sac.address();

        let vault_id = env.register_contract(None, VaultContract);
        let vault = VaultContractClient::new(&env, &vault_id);
        vault.initialize(&admin, &usdc, &noe, &market, &30, &30);

        StellarAssetClient::new(&env, &noe).mint(&vault_id, &(1_000_000_000 * PRECISION));
        StellarAssetClient::new(&env, &usdc).mint(&lp, &(100_000_000 * PRECISION));

        if initial_deposit > 0 {
            vault.deposit(&lp, &initial_deposit);
        }

        VaultTest { env, vault_id, vault, usdc, noe, market, admin, lp }
    }

    /// NOE withdrawals use transfer_from — the LP must approve the vault.
    fn approve_noe(t: &VaultTest, amount: i128) {
        soroban_sdk::token::Client::new(&t.env, &t.noe).approve(
            &t.lp,
            &t.vault_id,
            &amount,
            &1_000_000,
        );
    }

    fn btc(env: &Env) -> Symbol {
        Symbol::new(env, "BTC")
    }

    #[test]
    fn deposit_withdraw_round_trip_with_fees() {
        let t = setup(0);
        let usdc = soroban_sdk::token::Client::new(&t.env, &t.usdc);
        let start = usdc.balance(&t.lp);

        let noe_minted = t.vault.deposit(&t.lp, &(1_000 * PRECISION));
        assert!(noe_minted > 0);
        // 0.3% deposit fee: strictly less than 1:1
        assert!(noe_minted < 1_000 * PRECISION);
        assert!(t.vault.get_noe_balance(&t.lp) == noe_minted);

        approve_noe(&t, noe_minted);
        let usdc_back = t.vault.withdraw(&t.lp, &noe_minted);
        // Round trip pays both fees but can never mint value
        assert!(usdc_back > 0 && usdc_back < 1_000 * PRECISION);
        let end = usdc.balance(&t.lp);
        assert!(end <= start);
        // Vault keeps only the fee remainder
        assert!(usdc.balance(&t.vault_id) < 10 * PRECISION);
    }

    #[test]
    fn reserve_accumulates_and_enforces_caps() {
        let t = setup(1_000 * PRECISION);

        // Per-asset side cap: default 25% of AUM (~1000) = ~250
        t.vault
            .reserve_for_position(&btc(&t.env), &(200 * PRECISION), &(200 * PRECISION));
        assert_eq!(t.vault.get_reserved_payout(), 200 * PRECISION);

        let over_asset = t.vault.try_reserve_for_position(
            &btc(&t.env),
            &(100 * PRECISION),
            &(300 * PRECISION),
        );
        assert!(matches!(over_asset, Err(Ok(NoetherError::OpenInterestCapExceeded))));

        // Aggregate reservation cap: lift the asset cap out of the way,
        // then push reserved past 70% of AUM
        t.vault.set_asset_cap(&btc(&t.env), &10_000);
        t.vault
            .reserve_for_position(&btc(&t.env), &(450 * PRECISION), &(650 * PRECISION));
        assert_eq!(t.vault.get_reserved_payout(), 650 * PRECISION);
        let over_total = t.vault.try_reserve_for_position(
            &btc(&t.env),
            &(100 * PRECISION),
            &(750 * PRECISION),
        );
        assert!(matches!(over_total, Err(Ok(NoetherError::OpenInterestCapExceeded))));
    }

    #[test]
    fn sync_exposure_updates_upnl_and_releases_reservation() {
        let t = setup(1_000 * PRECISION);
        t.vault
            .reserve_for_position(&btc(&t.env), &(150 * PRECISION), &(150 * PRECISION));

        t.vault.sync_exposure(&btc(&t.env), &(50 * PRECISION), &0);
        assert_eq!(t.vault.get_asset_unrealized_pnl(&btc(&t.env)), 50 * PRECISION);
        let info = t.vault.get_pool_info();
        assert_eq!(info.unrealized_pnl, 50 * PRECISION);

        // Winning traders shrink AUM and the NOE price with it
        let aum = t.vault.get_aum();
        assert!(aum < 1_000 * PRECISION);

        t.vault.sync_exposure(&btc(&t.env), &(20 * PRECISION), &(100 * PRECISION));
        assert_eq!(t.vault.get_asset_unrealized_pnl(&btc(&t.env)), 20 * PRECISION);
        assert_eq!(t.vault.get_pool_info().unrealized_pnl, 20 * PRECISION);
        assert_eq!(t.vault.get_reserved_payout(), 50 * PRECISION);
    }

    #[test]
    fn settle_pnl_caps_payout_and_records_shortfall() {
        let t = setup(100 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&t.env, &t.usdc);

        let paid = t.vault.settle_pnl(&(150 * PRECISION));
        // Winner is paid what the pool holds — never a revert
        assert!(paid > 0 && paid <= 100 * PRECISION);
        assert_eq!(t.vault.get_shortfall(), 150 * PRECISION - paid);
        assert_eq!(usdc.balance(&t.market), paid);
        assert_eq!(t.vault.get_total_usdc(), 100 * PRECISION - paid);
    }

    #[test]
    fn losses_credit_only_on_receipt() {
        let t = setup(100 * PRECISION);

        // settle_pnl with a loss no longer credits anything
        let paid = t.vault.settle_pnl(&(-40 * PRECISION));
        assert_eq!(paid, 0);
        assert_eq!(t.vault.get_total_usdc(), 100 * PRECISION);

        // receive_loss credits exactly the transferred amount
        t.vault.receive_loss(&(40 * PRECISION));
        assert_eq!(t.vault.get_total_usdc(), 140 * PRECISION);
    }

    #[test]
    fn withdraw_cannot_undercut_reserved_payouts() {
        let t = setup(1_000 * PRECISION);
        t.vault.set_asset_cap(&btc(&t.env), &10_000);
        t.vault
            .reserve_for_position(&btc(&t.env), &(600 * PRECISION), &(600 * PRECISION));

        let noe = t.vault.get_noe_balance(&t.lp);
        approve_noe(&t, noe);
        // Withdrawing everything would leave less than the 600 reserved
        let blocked = t.vault.try_withdraw(&t.lp, &noe);
        assert!(matches!(blocked, Err(Ok(NoetherError::InsufficientLiquidity))));

        // A small withdrawal that keeps the reservation covered is fine
        let small = t.vault.withdraw(&t.lp, &(noe / 10));
        assert!(small > 0);
    }

    #[test]
    fn insurance_buffer_pays_winners_before_lp() {
        let t = setup(100 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&t.env, &t.usdc);

        // Seed the buffer with 50 USDC (admin-funded).
        t.vault.seed_buffer(&t.lp, &(50 * PRECISION));
        assert_eq!(t.vault.get_buffer_balance(), 50 * PRECISION);
        // Buffer is NOT LP value — total_usdc unchanged.
        assert_eq!(t.vault.get_total_usdc(), 100 * PRECISION);

        // A 30 USDC win is paid entirely from the buffer; LP untouched.
        let paid = t.vault.settle_pnl(&(30 * PRECISION));
        assert_eq!(paid, 30 * PRECISION);
        assert_eq!(t.vault.get_buffer_balance(), 20 * PRECISION);
        assert_eq!(t.vault.get_total_usdc(), 100 * PRECISION);
        assert_eq!(usdc.balance(&t.market), 30 * PRECISION);

        // A 40 USDC win exhausts the remaining 20 buffer, then 20 from LP.
        let paid2 = t.vault.settle_pnl(&(40 * PRECISION));
        assert_eq!(paid2, 40 * PRECISION);
        assert_eq!(t.vault.get_buffer_balance(), 0);
        assert_eq!(t.vault.get_total_usdc(), 80 * PRECISION);
    }

    #[test]
    fn fund_buffer_is_market_only() {
        let t = setup(100 * PRECISION);
        // Market-authed (mock_all_auths) works.
        t.vault.fund_buffer(&(10 * PRECISION));
        assert_eq!(t.vault.get_buffer_balance(), 10 * PRECISION);
        // Without auth, rejected.
        t.env.set_auths(&[]);
        assert!(t.vault.try_fund_buffer(&PRECISION).is_err());
    }

    #[test]
    fn market_only_endpoints_reject_without_auth() {
        let t = setup(100 * PRECISION);
        t.env.set_auths(&[]);
        assert!(t.vault.try_settle_pnl(&(10 * PRECISION)).is_err());
        assert!(t.vault
            .try_reserve_for_position(&btc(&t.env), &PRECISION, &PRECISION)
            .is_err());
        assert!(t.vault.try_sync_exposure(&btc(&t.env), &0, &0).is_err());
        assert!(t.vault.try_receive_loss(&PRECISION).is_err());
        let _ = (&t.admin, &t.vault_id);
    }
}
