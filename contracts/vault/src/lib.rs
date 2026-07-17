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

        // Guarded-launch per-account deposit cap (P6-6). 0 = unlimited.
        let cap = get_deposit_cap(&env);
        let already = get_deposited(&env, &depositor);
        if cap > 0 && already + usdc_amount > cap {
            return Err(NoetherError::DepositCapExceeded);
        }

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
        set_deposited(&env, &depositor, already + usdc_amount);
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

        // LP exits cannot pull liquidity out from under open positions
        // (M-4) — nor strip USDC earmarked for shortfall repayment (L0-3).
        if vault_balance - net_usdc < get_reserved_payout(&env) + storage::get_shortfall_reserve(&env) {
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
    /// any unpaid remainder is booked as a CLAIMABLE per-trader shortfall
    /// (L0-3: repaid from future buffer inflows via claim_shortfall).
    /// Losses are credited ONLY when the USDC actually arrives, via
    /// receive_loss.
    ///
    /// ⚠️ ABI: (env, trader, pnl) since L0-3 — market and vault MUST promote
    /// together (an old market calling the new vault traps on arg decode).
    pub fn settle_pnl(env: Env, trader: Address, pnl: i128) -> Result<i128, NoetherError> {
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
            // The ShortfallReserve is earmarked USDC (outside buffer + LP
            // accounting) — winner payouts may never physically spend it.
            let spendable_balance = vault_balance - storage::get_shortfall_reserve(&env);
            if paid > spendable_balance {
                paid = spendable_balance;
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
                storage::set_shortfall_owed(&env, &trader, storage::get_shortfall_owed(&env, &trader) + short);
                set_shortfall(&env, get_shortfall(&env) + short);
                storage::set_cum_shortfall(&env, storage::get_cum_shortfall(&env) + short);
                env.events().publish(
                    (Symbol::new(&env, "payout_shortfall"),),
                    (trader.clone(), pnl, paid, short),
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

    /// Set the per-account cumulative-deposit cap (7 decimals; 0 = unlimited).
    /// The guarded-launch lever (P6-6) — start low, raise on clean metrics.
    /// Admin only.
    pub fn set_deposit_cap(env: Env, cap: i128) -> Result<(), NoetherError> {
        require_admin(&env)?;
        if cap < 0 {
            return Err(NoetherError::InvalidAmount);
        }
        storage::set_deposit_cap(&env, cap);
        env.events().publish((Symbol::new(&env, "deposit_cap_set"),), (cap,));
        Ok(())
    }

    /// Current per-account deposit cap (0 = unlimited).
    pub fn get_deposit_cap(env: Env) -> i128 {
        storage::get_deposit_cap(&env)
    }

    /// Cumulative USDC an account has deposited (against the cap).
    pub fn get_deposited(env: Env, who: Address) -> i128 {
        storage::get_deposited(&env, &who)
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
        let to_reserve = Self::route_shortfall_share(&env, amount);
        set_buffer_balance(&env, get_buffer_balance(&env) + (amount - to_reserve));
        env.events().publish((Symbol::new(&env, "buffer_seeded"),), (amount, to_reserve));
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
        let to_reserve = Self::route_shortfall_share(&env, amount);
        set_buffer_balance(&env, get_buffer_balance(&env) + (amount - to_reserve));
        env.events().publish((Symbol::new(&env, "buffer_funded"),), (amount, to_reserve));
        Ok(())
    }

    /// The amortizer (L0-3): while any shortfall is outstanding, route
    /// ShortfallInflowBps of a buffer inflow into the repayment reserve,
    /// capped at what is still owed and not yet reserved. Returns to_reserve.
    fn route_shortfall_share(env: &Env, amount: i128) -> i128 {
        let outstanding = get_shortfall(env);
        let reserve = storage::get_shortfall_reserve(env);
        let unreserved = outstanding - reserve;
        if unreserved <= 0 {
            return 0;
        }
        let bps = storage::get_shortfall_inflow_bps(env) as i128;
        let mut to_reserve = amount * bps / (BASIS_POINTS as i128);
        if to_reserve > unreserved {
            to_reserve = unreserved;
        }
        if to_reserve <= 0 {
            return 0;
        }
        storage::set_shortfall_reserve(env, reserve + to_reserve);
        to_reserve
    }

    /// Claim short-paid winnings (L0-3). Pays min(owed, reserve + buffer,
    /// spendable balance), drawing the earmarked ShortfallReserve first and
    /// the insurance buffer for the remainder. Deliberately NOT pause-gated —
    /// winners must be able to claim during incidents (exit-only-pause
    /// philosophy, L0-15). Returns the amount paid; Ok(0) when nothing is
    /// owed or nothing is payable yet (call again after the next inflow).
    pub fn claim_shortfall(env: Env, trader: Address) -> Result<i128, NoetherError> {
        require_initialized(&env)?;
        trader.require_auth();

        let owed = storage::get_shortfall_owed(&env, &trader);
        if owed <= 0 {
            return Ok(0);
        }

        let reserve = storage::get_shortfall_reserve(&env);
        let buffer = get_buffer_balance(&env);
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        let vault_balance = token_client.balance(&env.current_contract_address());

        let mut pay = owed;
        if pay > reserve + buffer {
            pay = reserve + buffer;
        }
        if pay > vault_balance {
            pay = vault_balance;
        }
        if pay <= 0 {
            return Ok(0);
        }

        token_client.transfer(&env.current_contract_address(), &trader, &pay);

        // Reserve first, buffer for the remainder.
        let from_reserve = if pay > reserve { reserve } else { pay };
        if from_reserve > 0 {
            storage::set_shortfall_reserve(&env, reserve - from_reserve);
        }
        let from_buffer = pay - from_reserve;
        if from_buffer > 0 {
            set_buffer_balance(&env, buffer - from_buffer);
        }

        storage::set_shortfall_owed(&env, &trader, owed - pay);
        set_shortfall(&env, get_shortfall(&env) - pay);
        storage::set_cum_shortfall_repaid(&env, storage::get_cum_shortfall_repaid(&env) + pay);

        env.events().publish(
            (Symbol::new(&env, "shortfall_repaid"),),
            (trader.clone(), pay, owed - pay),
        );

        extend_instance_ttl(&env);
        Ok(pay)
    }

    /// Set the buffer-inflow share routed to shortfall repayment (bps). Admin.
    pub fn set_shortfall_inflow_bps(env: Env, bps: u32) -> Result<(), NoetherError> {
        require_admin(&env)?;
        if bps > BASIS_POINTS {
            return Err(NoetherError::InvalidParameter);
        }
        storage::set_shortfall_inflow_bps(&env, bps);
        Ok(())
    }

    /// A trader's outstanding claimable shortfall.
    pub fn get_shortfall_owed(env: Env, trader: Address) -> i128 {
        storage::get_shortfall_owed(&env, &trader)
    }

    /// USDC currently earmarked for shortfall repayment.
    pub fn get_shortfall_reserve(env: Env) -> i128 {
        storage::get_shortfall_reserve(&env)
    }

    /// Lifetime shortfall booked.
    pub fn get_cum_shortfall(env: Env) -> i128 {
        storage::get_cum_shortfall(&env)
    }

    /// Lifetime shortfall repaid.
    pub fn get_cum_shortfall_repaid(env: Env) -> i128 {
        storage::get_cum_shortfall_repaid(&env)
    }

    /// Current insurance buffer balance.
    pub fn get_buffer_balance(env: Env) -> i128 {
        storage::get_buffer_balance(&env)
    }

    /// Cover bankrupt-liquidation losses from the insurance buffer (L0-2).
    /// Market-only. ACCOUNTING-ONLY — no token moves: the bad-debt USDC was
    /// never collected, and the buffer's tokens already sit in the vault.
    /// Moving `covered` from the buffer bucket into total_usdc offsets the
    /// NAV drop the uncollected loss causes at close, 1:1 — NOE price stays
    /// flat when the buffer covers and falls by exactly the LP-absorbed
    /// remainder when it cannot. Returns the covered amount.
    ///
    /// Spend rule: the ShortfallReserve is a DISJOINT bucket (never inside
    /// BufferBalance), so every buffer spender — winner payouts in
    /// settle_pnl, this draw, claim_shortfall's buffer leg — reads the same
    /// BufferBalance and can never touch earmarked repayment funds.
    pub fn draw_buffer(env: Env, amount: i128) -> Result<i128, NoetherError> {
        require_initialized(&env)?;
        let market_contract = get_market_contract(&env);
        market_contract.require_auth();
        if amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        let buffer = get_buffer_balance(&env);
        let covered = if amount > buffer { buffer } else { amount };
        if covered > 0 {
            set_buffer_balance(&env, buffer - covered);
            set_total_usdc(&env, get_total_usdc(&env) + covered);
        }
        storage::set_cum_bad_debt_covered(
            &env, storage::get_cum_bad_debt_covered(&env) + covered,
        );
        storage::set_cum_bad_debt_lp_absorbed(
            &env, storage::get_cum_bad_debt_lp_absorbed(&env) + (amount - covered),
        );

        env.events().publish(
            (Symbol::new(&env, "buffer_drawn"),),
            (amount, covered),
        );
        Ok(covered)
    }

    /// Lifetime bankrupt losses the buffer absorbed.
    pub fn get_cum_bad_debt_covered(env: Env) -> i128 {
        storage::get_cum_bad_debt_covered(&env)
    }

    /// Lifetime bankrupt losses that fell through to LP NAV.
    pub fn get_cum_bad_debt_lp_absorbed(env: Env) -> i128 {
        storage::get_cum_bad_debt_lp_absorbed(&env)
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
        let winner = Address::generate(&t.env);

        let paid = t.vault.settle_pnl(&winner, &(150 * PRECISION));
        // Winner is paid what the pool holds — never a revert
        assert!(paid > 0 && paid <= 100 * PRECISION);
        assert_eq!(t.vault.get_shortfall(), 150 * PRECISION - paid);
        assert_eq!(usdc.balance(&t.market), paid);
        assert_eq!(t.vault.get_total_usdc(), 100 * PRECISION - paid);
        // L0-3: the gap is booked per-trader and in the lifetime counter
        assert_eq!(t.vault.get_shortfall_owed(&winner), 150 * PRECISION - paid);
        assert_eq!(t.vault.get_cum_shortfall(), 150 * PRECISION - paid);
    }

    #[test]
    fn losses_credit_only_on_receipt() {
        let t = setup(100 * PRECISION);
        let loser = Address::generate(&t.env);

        // settle_pnl with a loss no longer credits anything
        let paid = t.vault.settle_pnl(&loser, &(-40 * PRECISION));
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
        let winner = Address::generate(&t.env);
        let paid = t.vault.settle_pnl(&winner, &(30 * PRECISION));
        assert_eq!(paid, 30 * PRECISION);
        assert_eq!(t.vault.get_buffer_balance(), 20 * PRECISION);
        assert_eq!(t.vault.get_total_usdc(), 100 * PRECISION);
        assert_eq!(usdc.balance(&t.market), 30 * PRECISION);

        // A 40 USDC win exhausts the remaining 20 buffer, then 20 from LP.
        let paid2 = t.vault.settle_pnl(&winner, &(40 * PRECISION));
        assert_eq!(paid2, 40 * PRECISION);
        assert_eq!(t.vault.get_buffer_balance(), 0);
        assert_eq!(t.vault.get_total_usdc(), 80 * PRECISION);
    }

    // ── L0-3: shortfall repayment path ─────────────────────────────────────

    #[test]
    fn settle_pnl_books_per_trader_owed() {
        let t = setup(50 * PRECISION);
        let w1 = Address::generate(&t.env);
        let w2 = Address::generate(&t.env);

        // w1 wins 80 against a 50 pool: paid 50, owed 30.
        let paid1 = t.vault.settle_pnl(&w1, &(80 * PRECISION));
        assert_eq!(paid1, 50 * PRECISION);
        assert_eq!(t.vault.get_shortfall_owed(&w1), 30 * PRECISION);

        // w2 wins 20 against an empty pool: paid 0, owed 20.
        let paid2 = t.vault.settle_pnl(&w2, &(20 * PRECISION));
        assert_eq!(paid2, 0);
        assert_eq!(t.vault.get_shortfall_owed(&w2), 20 * PRECISION);

        // Outstanding total == Σ owed; lifetime counter matches.
        assert_eq!(t.vault.get_shortfall(), 50 * PRECISION);
        assert_eq!(t.vault.get_cum_shortfall(), 50 * PRECISION);
        assert_eq!(t.vault.get_cum_shortfall_repaid(), 0);
    }

    #[test]
    fn fund_buffer_routes_inflow_share_to_reserve_capped_at_outstanding() {
        let t = setup(10 * PRECISION);
        let w = Address::generate(&t.env);
        // Book a 20 shortfall (wins 30 against a 10 pool).
        t.vault.settle_pnl(&w, &(30 * PRECISION));
        assert_eq!(t.vault.get_shortfall(), 20 * PRECISION);

        // 50% of a 30 inflow = 15 → reserve; 15 → buffer.
        t.vault.fund_buffer(&(30 * PRECISION));
        assert_eq!(t.vault.get_shortfall_reserve(), 15 * PRECISION);
        assert_eq!(t.vault.get_buffer_balance(), 15 * PRECISION);

        // Next inflow: unreserved owed is only 5 — the split caps there.
        t.vault.fund_buffer(&(30 * PRECISION));
        assert_eq!(t.vault.get_shortfall_reserve(), 20 * PRECISION);
        assert_eq!(t.vault.get_buffer_balance(), 40 * PRECISION);

        // Fully reserved: everything flows to the buffer now.
        t.vault.fund_buffer(&(10 * PRECISION));
        assert_eq!(t.vault.get_shortfall_reserve(), 20 * PRECISION);
        assert_eq!(t.vault.get_buffer_balance(), 50 * PRECISION);
    }

    #[test]
    fn seed_buffer_split_matches_fund_buffer() {
        let t = setup(10 * PRECISION);
        let w = Address::generate(&t.env);
        t.vault.settle_pnl(&w, &(30 * PRECISION)); // owed 20

        t.vault.seed_buffer(&t.lp, &(30 * PRECISION));
        assert_eq!(t.vault.get_shortfall_reserve(), 15 * PRECISION);
        assert_eq!(t.vault.get_buffer_balance(), 15 * PRECISION);
    }

    #[test]
    fn claim_shortfall_pays_reserve_then_buffer() {
        let t = setup(10 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&t.env, &t.usdc);
        let w = Address::generate(&t.env);
        t.vault.settle_pnl(&w, &(30 * PRECISION)); // paid 10, owed 20

        // Inflow 20: reserve 10, buffer 10.
        t.vault.fund_buffer(&(20 * PRECISION));
        // The inflow is accounting-only here; back it with real USDC so the
        // claim transfer can settle (market transfers land separately).
        StellarAssetClient::new(&t.env, &t.usdc).mint(&t.vault_id, &(20 * PRECISION));

        let paid = t.vault.claim_shortfall(&w);
        // owed 20, reserve 10 + buffer 10 → paid in full, reserve first.
        assert_eq!(paid, 20 * PRECISION);
        assert_eq!(usdc.balance(&w), 20 * PRECISION);
        assert_eq!(t.vault.get_shortfall_reserve(), 0);
        assert_eq!(t.vault.get_buffer_balance(), 0);
        assert_eq!(t.vault.get_shortfall_owed(&w), 0);
        assert_eq!(t.vault.get_shortfall(), 0);
        assert_eq!(t.vault.get_cum_shortfall_repaid(), 20 * PRECISION);
    }

    #[test]
    fn claim_shortfall_zero_owed_returns_zero() {
        let t = setup(100 * PRECISION);
        let nobody = Address::generate(&t.env);
        let usdc = soroban_sdk::token::Client::new(&t.env, &t.usdc);
        assert_eq!(t.vault.claim_shortfall(&nobody), 0);
        assert_eq!(usdc.balance(&nobody), 0);
    }

    #[test]
    fn claim_partial_then_full_after_next_inflow() {
        let t = setup(10 * PRECISION);
        let w = Address::generate(&t.env);
        t.vault.settle_pnl(&w, &(30 * PRECISION)); // owed 20

        // First inflow 10 → reserve 5, buffer 5: partial claim of 10.
        t.vault.fund_buffer(&(10 * PRECISION));
        StellarAssetClient::new(&t.env, &t.usdc).mint(&t.vault_id, &(10 * PRECISION));
        let first = t.vault.claim_shortfall(&w);
        assert_eq!(first, 10 * PRECISION);
        assert_eq!(t.vault.get_shortfall_owed(&w), 10 * PRECISION);
        assert_eq!(t.vault.get_shortfall(), 10 * PRECISION);

        // Next inflow amortizes the rest.
        t.vault.fund_buffer(&(20 * PRECISION));
        StellarAssetClient::new(&t.env, &t.usdc).mint(&t.vault_id, &(20 * PRECISION));
        let second = t.vault.claim_shortfall(&w);
        assert_eq!(second, 10 * PRECISION);
        assert_eq!(t.vault.get_shortfall_owed(&w), 0);
        assert_eq!(t.vault.get_shortfall(), 0);
        assert_eq!(t.vault.get_cum_shortfall_repaid(), 20 * PRECISION);
        // Lifetime booked never decreases.
        assert_eq!(t.vault.get_cum_shortfall(), 20 * PRECISION);
    }

    #[test]
    fn lp_withdraw_floor_includes_shortfall_reserve() {
        let t = setup(100 * PRECISION);
        let w = Address::generate(&t.env);
        // Drain the pool via a 100 win, then book 20 more owed.
        t.vault.settle_pnl(&w, &(120 * PRECISION));
        assert_eq!(t.vault.get_shortfall(), 20 * PRECISION);

        // Refill: LP deposits 100; an inflow of 40 reserves 20 for the claim.
        // Deliberately accounting-only (no backing mint) so the earmark must
        // bind against the SAME USDC the LP wants to withdraw.
        t.vault.deposit(&t.lp, &(100 * PRECISION));
        t.vault.fund_buffer(&(40 * PRECISION));
        assert_eq!(t.vault.get_shortfall_reserve(), 20 * PRECISION);

        // Withdrawing EVERYTHING would strip the earmarked 20 — blocked.
        let noe = t.vault.get_noe_balance(&t.lp);
        approve_noe(&t, noe);
        let blocked = t.vault.try_withdraw(&t.lp, &noe);
        assert!(matches!(blocked, Err(Ok(NoetherError::InsufficientLiquidity))));

        // A partial withdrawal that leaves the reserve covered is fine.
        let small = t.vault.withdraw(&t.lp, &(noe / 4));
        assert!(small > 0);
    }

    #[test]
    fn claim_works_while_paused() {
        let t = setup(10 * PRECISION);
        let w = Address::generate(&t.env);
        t.vault.settle_pnl(&w, &(30 * PRECISION)); // owed 20
        t.vault.fund_buffer(&(20 * PRECISION));
        StellarAssetClient::new(&t.env, &t.usdc).mint(&t.vault_id, &(20 * PRECISION));

        t.vault.pause();
        // Winners must be able to claim during incidents (exit-only-pause).
        let paid = t.vault.claim_shortfall(&w);
        assert_eq!(paid, 20 * PRECISION);
        t.vault.unpause();
    }

    // ── L0-2: bad-debt draw ─────────────────────────────────────────────

    #[test]
    fn draw_buffer_moves_buffer_into_lp_accounting() {
        let t = setup(100 * PRECISION);
        t.vault.fund_buffer(&(50 * PRECISION));
        let aum_before = t.vault.get_aum();

        let covered = t.vault.draw_buffer(&(30 * PRECISION));
        assert_eq!(covered, 30 * PRECISION);
        assert_eq!(t.vault.get_buffer_balance(), 20 * PRECISION);
        // The covered amount moved INTO LP accounting (buffer is outside
        // AUM, total_usdc is inside) — the offset half of NAV flatness.
        assert_eq!(t.vault.get_aum() - aum_before, 30 * PRECISION);
        assert_eq!(t.vault.get_cum_bad_debt_covered(), 30 * PRECISION);
        assert_eq!(t.vault.get_cum_bad_debt_lp_absorbed(), 0);
    }

    #[test]
    fn draw_buffer_partial_cover_returns_actual() {
        let t = setup(100 * PRECISION);
        t.vault.fund_buffer(&(10 * PRECISION));

        let covered = t.vault.draw_buffer(&(35 * PRECISION));
        assert_eq!(covered, 10 * PRECISION);
        assert_eq!(t.vault.get_buffer_balance(), 0);
        assert_eq!(t.vault.get_cum_bad_debt_covered(), 10 * PRECISION);
        assert_eq!(t.vault.get_cum_bad_debt_lp_absorbed(), 25 * PRECISION);
    }

    #[test]
    fn draw_buffer_market_only_auth() {
        let t = setup(100 * PRECISION);
        t.vault.fund_buffer(&(10 * PRECISION));
        t.env.set_auths(&[]);
        assert!(t.vault.try_draw_buffer(&PRECISION).is_err());
    }

    #[test]
    fn outstanding_equals_sum_of_owed_map() {
        let t = setup(30 * PRECISION);
        let w1 = Address::generate(&t.env);
        let w2 = Address::generate(&t.env);

        t.vault.settle_pnl(&w1, &(50 * PRECISION)); // paid 30, owed 20
        t.vault.settle_pnl(&w2, &(15 * PRECISION)); // paid 0, owed 15
        assert_eq!(
            t.vault.get_shortfall(),
            t.vault.get_shortfall_owed(&w1) + t.vault.get_shortfall_owed(&w2)
        );

        // Repay some of w1 and re-check the invariant at every step.
        t.vault.fund_buffer(&(20 * PRECISION));
        StellarAssetClient::new(&t.env, &t.usdc).mint(&t.vault_id, &(20 * PRECISION));
        t.vault.claim_shortfall(&w1);
        assert_eq!(
            t.vault.get_shortfall(),
            t.vault.get_shortfall_owed(&w1) + t.vault.get_shortfall_owed(&w2)
        );
        // Claim payout never exceeded min(owed, reserve+buffer): w2 still owed.
        assert!(t.vault.get_shortfall_owed(&w2) > 0);
    }

    #[test]
    fn deposit_cap_enforced_per_account() {
        let t = setup(0);
        // Cap each account at 500 USDC.
        t.vault.set_deposit_cap(&(500 * PRECISION));
        assert_eq!(t.vault.get_deposit_cap(), 500 * PRECISION);

        // First deposit under the cap works and records cumulative.
        t.vault.deposit(&t.lp, &(300 * PRECISION));
        assert_eq!(t.vault.get_deposited(&t.lp), 300 * PRECISION);

        // A second deposit crossing the cap is rejected.
        let over = t.vault.try_deposit(&t.lp, &(300 * PRECISION));
        assert_eq!(over, Err(Ok(NoetherError::DepositCapExceeded)));

        // Exactly hitting the cap is allowed.
        t.vault.deposit(&t.lp, &(200 * PRECISION));
        assert_eq!(t.vault.get_deposited(&t.lp), 500 * PRECISION);

        // Cap = 0 disables the limit.
        t.vault.set_deposit_cap(&0);
        let ok = t.vault.deposit(&t.lp, &(1_000 * PRECISION));
        assert!(ok > 0);
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
        let anyone = Address::generate(&t.env);
        assert!(t.vault.try_settle_pnl(&anyone, &(10 * PRECISION)).is_err());
        assert!(t.vault
            .try_reserve_for_position(&btc(&t.env), &PRECISION, &PRECISION)
            .is_err());
        assert!(t.vault.try_sync_exposure(&btc(&t.env), &0, &0).is_err());
        assert!(t.vault.try_receive_loss(&PRECISION).is_err());
        let _ = (&t.admin, &t.vault_id);
    }
}
