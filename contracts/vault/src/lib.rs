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

/// L0-15: an admin recovery proposal is executable only after this delay —
/// the depositor's protection window against a break-glass drain (48h).
pub const RECOVERY_TIMELOCK_SECS: u64 = 172_800;

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
    pub fn deposit(
        env: Env,
        depositor: Address,
        usdc_amount: i128,
        min_noe_out: i128,
    ) -> Result<i128, NoetherError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;

        if usdc_amount <= 0 || min_noe_out < 0 {
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

        // R-6 guarded-launch GLOBAL principal cap (0 = unlimited): bounds
        // total LP exposure during waves, checked on the net credit.
        let aum_cap = storage::get_aum_cap(&env);
        if aum_cap > 0 && get_total_usdc(&env) + net_amount > aum_cap {
            return Err(NoetherError::DepositCapExceeded);
        }

        // Get current pool state
        let circulating_noe = get_total_noe_circulating(&env);
        let aum = Self::calculate_aum_internal(&env);

        // Calculate NOE to transfer to user
        let noe_amount = calculate_glp_for_deposit(net_amount, circulating_noe, aum)?;

        if noe_amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        // R-6/ALX-16: caller-declared slippage bound — AUM moves between
        // signing and inclusion (marks, funding, settlements), so the LP
        // states the worst mint they'll accept. 0 = no bound.
        if noe_amount < min_noe_out {
            return Err(NoetherError::InvalidSlippageTolerance);
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

        // Update pool state. Credit only the NET principal to LP accounting —
        // the fee is booked separately in total_fees (which AUM already adds).
        // Crediting the gross here would double-count the fee into AUM and
        // inflate NOE price above the vault's physical USDC on every deposit.
        set_total_usdc(&env, get_total_usdc(&env) + net_amount);
        set_deposited(&env, &depositor, already + usdc_amount);
        // L1-28: re-arm the withdraw cooldown on every deposit (topping up
        // resets the clock, killing deposit-just-before-a-settlement timing).
        set_last_deposit_ts(&env, &depositor, env.ledger().timestamp());
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
    pub fn withdraw(
        env: Env,
        withdrawer: Address,
        noe_amount: i128,
        min_usdc_out: i128,
    ) -> Result<i128, NoetherError> {
        require_initialized(&env)?;
        // L0-15 exit-only: withdrawals are NEVER pause-gated — LPs must always
        // be able to exit. The ReservedPayout solvency floor below is the only
        // gate, so committed trader payouts stay protected.

        if noe_amount <= 0 || min_usdc_out < 0 {
            return Err(NoetherError::InvalidAmount);
        }

        withdrawer.require_auth();

        // L1-28: post-deposit cooldown (anti-JIT/NAV-sniping). Ordered AFTER
        // exit-only pass and BEFORE the solvency floor so an emergency can't
        // bypass it. last==0 (never deposited post-upgrade) is exempt.
        let cooldown = storage::get_withdraw_cooldown_secs(&env);
        let last = storage::get_last_deposit_ts(&env, &withdrawer);
        if cooldown > 0 && last > 0 && env.ledger().timestamp() < last.saturating_add(cooldown) {
            return Err(NoetherError::WithdrawCooldownActive);
        }

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

        // R-6/ALX-16: caller-declared slippage bound (0 = no bound).
        if net_usdc < min_usdc_out {
            return Err(NoetherError::InvalidSlippageTolerance);
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

        // Footprint stability across a sign flip (2026-08-30): a close that
        // simulated as a win must already carry every bucket the loss path
        // reads (receive_loss → require_cash_covers_buckets), so write them
        // back unchanged. Soroban freezes the read/write footprint at
        // simulation; a key first touched at apply time traps the whole tx.
        storage::set_total_fees(&env, storage::get_total_fees(&env));
        storage::set_shortfall_reserve(&env, storage::get_shortfall_reserve(&env));
        // Same class for the shortfall books: a winning close simulated while
        // the vault covers in full carries none of these keys, so a
        // settlement that drains coverage between simulate and apply turns
        // the booking below into an out-of-footprint trap — at exactly the
        // moment liquidations matter, and on every caller that runs without
        // the client-side footprint guard (keeper, vault-factory leaders).
        // Written back for both signs so settle_pnl's key set never depends
        // on vault state.
        storage::set_shortfall_owed(&env, &trader, storage::get_shortfall_owed(&env, &trader));
        set_shortfall(&env, get_shortfall(&env));
        storage::set_cum_shortfall(&env, storage::get_cum_shortfall(&env));

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
            }
            // Draw from the buffer first, then LP value. Both writes are
            // UNCONDITIONAL (a zero draw writes the value back): the set of
            // keys a close writes must not depend on whether the buffer
            // happened to be empty at simulation time. A buffer refilled by
            // another transaction between simulate and apply used to turn a
            // read-only footprint entry into a write and trap the whole
            // close with Storage/ExceededLimit (2026-08-30 incident).
            let from_buffer = if paid > buffer { buffer } else { paid };
            set_buffer_balance(&env, buffer - from_buffer);
            set_total_usdc(&env, total_usdc - (paid - from_buffer));
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
        // Footprint stability across a sign flip (see settle_pnl): the win
        // path writes these; a close simulated as a loss must carry them too.
        storage::set_buffer_balance(&env, storage::get_buffer_balance(&env));
        storage::set_total_fees(&env, storage::get_total_fees(&env));
        storage::set_shortfall_reserve(&env, storage::get_shortfall_reserve(&env));
        Self::require_cash_covers_buckets(&env)?;

        env.events().publish(
            (Symbol::new(&env, "loss_received"),),
            (amount,),
        );

        Ok(())
    }

    /// R-4: fail-closed receipt check for market-credited inflows. The
    /// market transfers USDC BEFORE calling a credit endpoint, so after
    /// crediting, the physical balance must cover every cash-backed
    /// bucket. A violation means the transfer never happened (or the
    /// accounting drifted) — refuse to book phantom assets.
    fn require_cash_covers_buckets(env: &Env) -> Result<(), NoetherError> {
        let usdc_token = get_usdc_token(env);
        let balance =
            token::Client::new(env, &usdc_token).balance(&env.current_contract_address());
        let backed = get_total_usdc(env)
            + get_total_fees(env)
            + get_buffer_balance(env)
            + storage::get_shortfall_reserve(env);
        if balance < backed {
            return Err(NoetherError::InsufficientBalance);
        }
        Ok(())
    }

    /// L1-23: pay a keeper bounty from the insurance buffer (market-only).
    /// Returns the amount actually paid = min(requested, buffer, vault USDC
    /// balance). A dry buffer returns 0 and NEVER errors — a bounty must never
    /// block a liquidation clear. Buffer is debited; USDC moves vault→keeper.
    pub fn pay_bounty(env: Env, keeper: Address, amount: i128) -> Result<i128, NoetherError> {
        require_initialized(&env)?;
        let market_contract = get_market_contract(&env);
        market_contract.require_auth();
        if amount <= 0 {
            return Ok(0);
        }
        let buffer = get_buffer_balance(&env);
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        let bal = token_client.balance(&env.current_contract_address());
        // The ShortfallReserve is earmarked USDC (owed to shortfall claimants,
        // outside buffer + LP accounting) — a bounty may never physically spend
        // it. Mirror the settle_pnl / claim_shortfall spendable cap.
        let spendable = bal - storage::get_shortfall_reserve(&env);
        let paid = amount.min(buffer).min(spendable).max(0);
        // Written back even when nothing is paid (footprint stability).
        set_buffer_balance(&env, buffer - paid);
        if paid <= 0 {
            env.events().publish((Symbol::new(&env, "bounty_paid"),), (keeper, amount, 0i128));
            return Ok(0);
        }
        token_client.transfer(&env.current_contract_address(), &keeper, &paid);
        env.events().publish((Symbol::new(&env, "bounty_paid"),), (keeper, amount, paid));
        Ok(paid)
    }

    /// L1-22: route a protocol fee (already transferred into the vault by the
    /// market) — fill the insurance buffer UP TO its target (10% of Reserved
    /// Payout by default), then overflow the rest to `overflow_to` (treasury).
    /// Market-only; NEVER touches LP value. Empty book (target 0) → all overflow.
    pub fn route_protocol_fee(env: Env, amount: i128, overflow_to: Address) -> Result<(), NoetherError> {
        require_initialized(&env)?;
        let market_contract = get_market_contract(&env);
        market_contract.require_auth();
        if amount <= 0 {
            return Ok(());
        }
        let target = get_reserved_payout(&env) * (storage::get_buffer_target_bps(&env) as i128)
            / (BASIS_POINTS as i128);
        let buffer = get_buffer_balance(&env);
        let room = if target > buffer { target - buffer } else { 0 };
        let to_buffer = if amount < room { amount } else { room };
        // Unconditional write + unconditional (possibly zero) treasury
        // transfer: an open's footprint must not depend on how full the
        // buffer is at simulation time (footprint stability, see settle_pnl).
        set_buffer_balance(&env, buffer + to_buffer);
        let overflow = amount - to_buffer;
        let usdc_token = get_usdc_token(&env);
        token::Client::new(&env, &usdc_token).transfer(
            &env.current_contract_address(),
            &overflow_to,
            &overflow,
        );
        Self::require_cash_covers_buckets(&env)?;
        env.events().publish(
            (Symbol::new(&env, "protocol_fee_routed"),),
            (amount, to_buffer, overflow),
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
    /// ⚠️ ABI: signature grew net_skew args in L0-14 — market and vault
    /// MUST promote together.
    pub fn reserve_for_position(
        env: Env,
        asset: Symbol,
        amount: i128,
        asset_side_oi_after: i128,
        net_skew_before: i128,
        net_skew_after: i128,
    ) -> Result<(), NoetherError> {
        require_initialized(&env)?;

        if amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        let market_contract = get_market_contract(&env);
        market_contract.require_auth();

        let aum = Self::calculate_aum_internal(&env);
        let reserved = get_reserved_payout(&env);
        let bps = BASIS_POINTS as i128;

        let reserve_cap = aum * (get_reserve_cap_bps(&env) as i128) / bps;
        if reserved + amount > reserve_cap {
            return Err(NoetherError::OpenInterestCapExceeded);
        }

        // Per-asset-side OI cap: min(bps×AUM, absolute) (L0-14). The absolute
        // leg is the anti-TVL-scaling backstop; 0 = bps-only.
        let cap_bps_leg = aum * (storage::get_asset_cap_bps(&env, &asset) as i128) / bps;
        let cap_abs = storage::get_asset_cap_abs(&env, &asset);
        let effective_cap = if cap_abs > 0 && cap_abs < cap_bps_leg { cap_abs } else { cap_bps_leg };
        if asset_side_oi_after > effective_cap {
            return Err(NoetherError::OpenInterestCapExceeded);
        }

        // Net-skew cap (L0-14): reject opens that push |net skew| past the
        // cap AND make it worse. Skew-REDUCING opens always pass, even when
        // a cap was tightened below the live skew.
        let skew_cap = aum * (storage::get_skew_cap_bps(&env, &asset) as i128) / bps;
        let abs_after = if net_skew_after < 0 { -net_skew_after } else { net_skew_after };
        let abs_before = if net_skew_before < 0 { -net_skew_before } else { net_skew_before };
        if abs_after > skew_cap && abs_after > abs_before {
            return Err(NoetherError::SkewCapExceeded);
        }

        // The pool must also physically hold what it already promised
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        let vault_balance = token_client.balance(&env.current_contract_address());
        // Earmarked shortfall USDC is already owed out — it cannot back new
        // position reservations. Exclude it from the physical coverage check.
        if reserved + amount > vault_balance - storage::get_shortfall_reserve(&env) {
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

    /// R-6: set the GLOBAL LP-principal cap (7 decimals; 0 = unlimited).
    /// The wave-size lever — bounds total_usdc across ALL depositors so
    /// absolute protocol size stays inside the soak plan. Admin only.
    pub fn set_aum_cap(env: Env, cap: i128) -> Result<(), NoetherError> {
        require_admin(&env)?;
        if cap < 0 {
            return Err(NoetherError::InvalidAmount);
        }
        storage::set_aum_cap(&env, cap);
        env.events().publish((Symbol::new(&env, "aum_cap_set"),), (cap,));
        Ok(())
    }

    /// Current global LP-principal cap (0 = unlimited).
    pub fn get_aum_cap(env: Env) -> i128 {
        storage::get_aum_cap(&env)
    }

    /// L1-28: set the post-deposit withdraw cooldown (admin, ≤ 1 day; 0 off).
    pub fn set_withdraw_cooldown(env: Env, secs: u64) -> Result<(), NoetherError> {
        require_admin(&env)?;
        if secs > 86_400 {
            return Err(NoetherError::InvalidParameter);
        }
        storage::set_withdraw_cooldown_secs(&env, secs);
        env.events().publish((Symbol::new(&env, "withdraw_cooldown_set"),), (secs,));
        Ok(())
    }

    /// L1-28 views: the cooldown window + an address's latest-deposit ts (the
    /// UI countdown source).
    pub fn get_withdraw_cooldown(env: Env) -> u64 {
        storage::get_withdraw_cooldown_secs(&env)
    }

    pub fn get_last_deposit_ts(env: Env, who: Address) -> u64 {
        storage::get_last_deposit_ts(&env, &who)
    }

    /// L1-22: set the insurance-buffer target as bps of ReservedPayout (admin,
    /// ≤ 10_000; default 1000 = 10%).
    pub fn set_buffer_target(env: Env, bps: u32) -> Result<(), NoetherError> {
        require_admin(&env)?;
        if bps > 10_000 {
            return Err(NoetherError::InvalidParameter);
        }
        storage::set_buffer_target_bps(&env, bps);
        env.events().publish((Symbol::new(&env, "buffer_target_set"),), (bps,));
        Ok(())
    }

    pub fn get_buffer_target_bps(env: Env) -> u32 {
        storage::get_buffer_target_bps(&env)
    }

    /// L1-22 read-side (API coverage calc): aggregate + per-asset OI cap bps.
    pub fn get_reserve_cap(env: Env) -> u32 {
        storage::get_reserve_cap_bps(&env)
    }

    pub fn get_asset_cap(env: Env, asset: Symbol) -> u32 {
        storage::get_asset_cap_bps(&env, &asset)
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
        Self::require_cash_covers_buckets(&env)?;
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
        // Read and write unconditionally so the footprint of a buffer inflow
        // never depends on whether a shortfall happens to be outstanding.
        let bps = storage::get_shortfall_inflow_bps(env) as i128;
        let mut to_reserve: i128 = 0;
        if unreserved > 0 {
            to_reserve = amount * bps / (BASIS_POINTS as i128);
            if to_reserve > unreserved {
                to_reserve = unreserved;
            }
            if to_reserve < 0 {
                to_reserve = 0;
            }
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
        // Both written unconditionally (footprint stability, see settle_pnl).
        storage::set_shortfall_reserve(&env, reserve - from_reserve);
        let from_buffer = pay - from_reserve;
        set_buffer_balance(&env, buffer - from_buffer);

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
        env.events().publish(
            (Symbol::new(&env, "shortfall_bps_set"),),
            (bps,),
        );
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
        // Unconditional write-back (footprint stability, see settle_pnl).
        set_buffer_balance(&env, buffer - covered);
        set_total_usdc(&env, get_total_usdc(&env) + covered);
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

    /// Pay USDC from the insurance buffer to an address (L0-1: the ADL
    /// better-than-mark compensation). Market-only; caps at the spendable
    /// buffer AND the vault's physical balance net of the earmarked
    /// ShortfallReserve. Returns the amount actually paid.
    pub fn pay_from_buffer(env: Env, to: Address, amount: i128) -> Result<i128, NoetherError> {
        require_initialized(&env)?;
        let market_contract = get_market_contract(&env);
        market_contract.require_auth();
        if amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }

        let buffer = get_buffer_balance(&env);
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        let spendable_balance = token_client.balance(&env.current_contract_address())
            - storage::get_shortfall_reserve(&env);

        let mut pay = if amount > buffer { buffer } else { amount };
        if pay > spendable_balance {
            pay = spendable_balance;
        }
        if pay > 0 {
            token_client.transfer(&env.current_contract_address(), &to, &pay);
        } else {
            pay = 0;
        }
        // Written back even for a zero payout (footprint stability).
        set_buffer_balance(&env, buffer - pay);

        env.events().publish(
            (Symbol::new(&env, "buffer_paid"),),
            (to.clone(), amount, pay),
        );
        Ok(pay)
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
        env.events().publish(
            (Symbol::new(&env, "reserve_cap_set"),),
            (bps,),
        );
        Ok(())
    }

    /// Set one asset's per-side OI cap (bps of AUM). Admin only.
    pub fn set_asset_cap(env: Env, asset: Symbol, bps: u32) -> Result<(), NoetherError> {
        require_admin(&env)?;
        if bps == 0 || bps > BASIS_POINTS {
            return Err(NoetherError::InvalidParameter);
        }
        storage::set_asset_cap_bps(&env, &asset, bps);
        env.events().publish(
            (Symbol::new(&env, "asset_cap_set"),),
            (asset, bps),
        );
        Ok(())
    }

    /// Set an asset's ABSOLUTE per-side OI cap in USD notional (L0-14).
    /// 0 = no absolute bound (bps-only). Admin only.
    pub fn set_asset_cap_abs(env: Env, asset: Symbol, max_notional: i128) -> Result<(), NoetherError> {
        require_admin(&env)?;
        if max_notional < 0 {
            return Err(NoetherError::InvalidParameter);
        }
        storage::set_asset_cap_abs(&env, &asset, max_notional);
        env.events().publish((Symbol::new(&env, "asset_cap_abs_set"),), (asset, max_notional));
        Ok(())
    }

    /// Set an asset's net-skew cap (bps of AUM) (L0-14). Admin only.
    pub fn set_skew_cap(env: Env, asset: Symbol, bps: u32) -> Result<(), NoetherError> {
        require_admin(&env)?;
        if bps == 0 || bps > BASIS_POINTS {
            return Err(NoetherError::InvalidParameter);
        }
        storage::set_skew_cap_bps(&env, &asset, bps);
        env.events().publish((Symbol::new(&env, "skew_cap_set"),), (asset, bps));
        Ok(())
    }

    /// Per-asset caps (L0-14): (cap_bps, cap_abs, skew_cap_bps,
    /// effective_cap_now). effective_cap_now = min(AUM×cap_bps, cap_abs)
    /// so one read feeds the api stats, specs, and headroom surfaces.
    pub fn get_asset_caps(env: Env, asset: Symbol) -> (u32, i128, u32, i128) {
        let cap_bps = storage::get_asset_cap_bps(&env, &asset);
        let cap_abs = storage::get_asset_cap_abs(&env, &asset);
        let skew_bps = storage::get_skew_cap_bps(&env, &asset);
        let aum = Self::calculate_aum_internal(&env);
        let bps_leg = aum * (cap_bps as i128) / (BASIS_POINTS as i128);
        let effective = if cap_abs > 0 && cap_abs < bps_leg { cap_abs } else { bps_leg };
        (cap_bps, cap_abs, skew_bps, effective)
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

    /// Unpause the vault. Auto-cancels any open recovery proposal (L0-15) —
    /// leaving the emergency once the emergency is over must retract the
    /// break-glass.
    pub fn unpause(env: Env) -> Result<(), NoetherError> {
        require_admin(&env)?;
        set_paused(&env, false);
        storage::clear_recovery_proposal(&env);

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

    // emergency_withdraw DELETED (L0-15) — an admin could move ANY amount to
    // ANY address instantly while paused (SEC-3 custody risk). Replaced by the
    // timelocked recovery below: fixed pre-declared destination + 48h delay +
    // events. Recovery deliberately MAY move reserved funds (break-glass for a
    // live exploit); the delay + fixed destination + events are the protection,
    // stated on the /vault RiskDisclosure.

    /// One-shot init of the pre-declared recovery destination (called by the
    /// deploy script post-initialize). Changing it later requires upgrade().
    pub fn init_recovery(env: Env, addr: Address) -> Result<(), NoetherError> {
        require_admin(&env)?;
        if storage::get_recovery_address(&env).is_some() {
            return Err(NoetherError::AlreadyInitialized);
        }
        storage::set_recovery_address(&env, &addr);
        env.events().publish((Symbol::new(&env, "recovery_init"),), (addr,));
        Ok(())
    }

    /// Propose a timelocked recovery (admin, paused-only). Executable only
    /// after RECOVERY_TIMELOCK_SECS.
    pub fn propose_recovery(env: Env, amount: i128) -> Result<(), NoetherError> {
        require_admin(&env)?;
        if !get_paused(&env) {
            return Err(NoetherError::InvalidParameter);
        }
        if amount <= 0 {
            return Err(NoetherError::InvalidAmount);
        }
        if storage::get_recovery_address(&env).is_none() {
            return Err(NoetherError::NotInitialized);
        }
        let execute_after = env.ledger().timestamp().saturating_add(RECOVERY_TIMELOCK_SECS);
        storage::set_recovery_proposal(&env, amount, execute_after);
        env.events().publish(
            (Symbol::new(&env, "recovery_proposed"),),
            (amount, execute_after),
        );
        Ok(())
    }

    /// Execute a matured recovery proposal (admin, paused-only). Pays
    /// min(amount, balance) to the pre-declared RecoveryAddress and clears it.
    pub fn execute_recovery(env: Env) -> Result<(), NoetherError> {
        require_admin(&env)?;
        if !get_paused(&env) {
            return Err(NoetherError::InvalidParameter);
        }
        let (amount, execute_after) =
            storage::get_recovery_proposal(&env).ok_or(NoetherError::InvalidParameter)?;
        if env.ledger().timestamp() < execute_after {
            return Err(NoetherError::InvalidParameter); // timelock not elapsed
        }
        let recipient = storage::get_recovery_address(&env).ok_or(NoetherError::NotInitialized)?;
        let usdc_token = get_usdc_token(&env);
        let token_client = token::Client::new(&env, &usdc_token);
        let balance = token_client.balance(&env.current_contract_address());
        let pay = if amount > balance { balance } else { amount };
        if pay > 0 {
            token_client.transfer(&env.current_contract_address(), &recipient, &pay);
        }
        storage::clear_recovery_proposal(&env);
        env.events().publish(
            (Symbol::new(&env, "recovery_executed"),),
            (pay, recipient),
        );
        Ok(())
    }

    /// Cancel an open recovery proposal (admin).
    pub fn cancel_recovery(env: Env) -> Result<(), NoetherError> {
        require_admin(&env)?;
        storage::clear_recovery_proposal(&env);
        env.events().publish((Symbol::new(&env, "recovery_cancelled"),), ());
        Ok(())
    }

    /// View: the pre-declared recovery destination (None until init_recovery).
    pub fn get_recovery_address(env: Env) -> Option<Address> {
        storage::get_recovery_address(&env)
    }

    /// View: the open recovery proposal (amount, execute_after), if any.
    pub fn get_recovery_proposal(env: Env) -> Option<(i128, u64)> {
        storage::get_recovery_proposal(&env)
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

    /// Fee-free fixture. The settlement / shortfall / reserve suites assert
    /// exact round numbers and are not about deposit fees, so deposits credit
    /// gross == net here. Fee accounting is covered by dedicated tests that use
    /// `setup_with_fees` (e.g. deposit_fee_does_not_inflate_aum).
    fn setup(initial_deposit: i128) -> VaultTest {
        setup_with_fees(initial_deposit, 0, 0)
    }

    fn setup_with_fees(
        initial_deposit: i128,
        deposit_fee_bps: u32,
        withdraw_fee_bps: u32,
    ) -> VaultTest {
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
        vault.initialize(&admin, &usdc, &noe, &market, &deposit_fee_bps, &withdraw_fee_bps);

        StellarAssetClient::new(&env, &noe).mint(&vault_id, &(1_000_000_000 * PRECISION));
        StellarAssetClient::new(&env, &usdc).mint(&lp, &(100_000_000 * PRECISION));

        if initial_deposit > 0 {
            vault.deposit(&lp, &initial_deposit, &0);
        }

        VaultTest { env, vault_id, vault, usdc, noe, market, admin, lp }
    }

    /// R-4: the real market transfers USDC into the vault BEFORE calling a
    /// credit endpoint; tests must mirror that or the receipt check trips.
    fn market_inflow(t: &VaultTest, amount: i128) {
        StellarAssetClient::new(&t.env, &t.usdc).mint(&t.vault_id, &amount);
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
        let t = setup_with_fees(0, 30, 30);
        let usdc = soroban_sdk::token::Client::new(&t.env, &t.usdc);
        let start = usdc.balance(&t.lp);

        let noe_minted = t.vault.deposit(&t.lp, &(1_000 * PRECISION), &0);
        assert!(noe_minted > 0);
        // 0.3% deposit fee: strictly less than 1:1
        assert!(noe_minted < 1_000 * PRECISION);
        assert!(t.vault.get_noe_balance(&t.lp) == noe_minted);

        t.env.ledger().with_mut(|l| l.timestamp += 1_800); // L1-28: clear cooldown
        approve_noe(&t, noe_minted);
        let usdc_back = t.vault.withdraw(&t.lp, &noe_minted, &0);
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
            .reserve_for_position(&btc(&t.env), &(200 * PRECISION), &(200 * PRECISION), &0, &0);
        assert_eq!(t.vault.get_reserved_payout(), 200 * PRECISION);

        let over_asset = t.vault.try_reserve_for_position(
            &btc(&t.env),
            &(100 * PRECISION),
            &(300 * PRECISION),
            &0,
            &0,
        );
        assert!(matches!(over_asset, Err(Ok(NoetherError::OpenInterestCapExceeded))));

        // Aggregate reservation cap: lift the asset cap out of the way,
        // then push reserved past 70% of AUM
        t.vault.set_asset_cap(&btc(&t.env), &10_000);
        t.vault
            .reserve_for_position(&btc(&t.env), &(450 * PRECISION), &(650 * PRECISION), &0, &0);
        assert_eq!(t.vault.get_reserved_payout(), 650 * PRECISION);
        let over_total = t.vault.try_reserve_for_position(
            &btc(&t.env),
            &(100 * PRECISION),
            &(750 * PRECISION),
            &0,
            &0,
        );
        assert!(matches!(over_total, Err(Ok(NoetherError::OpenInterestCapExceeded))));
    }

    #[test]
    fn sync_exposure_updates_upnl_and_releases_reservation() {
        let t = setup(1_000 * PRECISION);
        t.vault
            .reserve_for_position(&btc(&t.env), &(150 * PRECISION), &(150 * PRECISION), &0, &0);

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
        market_inflow(&t, 40 * PRECISION);
        t.vault.receive_loss(&(40 * PRECISION));
        assert_eq!(t.vault.get_total_usdc(), 140 * PRECISION);
    }

    // ── L0-14: absolute OI cap + net-skew cap ───────────────────────────

    #[test]
    fn absolute_cap_binds_below_the_bps_leg() {
        let t = setup(1_000 * PRECISION);
        // bps leg = 25% of ~1000 AUM = ~250. Set an absolute cap of 100 USD.
        t.vault.set_asset_cap_abs(&btc(&t.env), &(100 * PRECISION));
        // 90 (skew-neutral) fits under the 100 absolute cap.
        t.vault.reserve_for_position(&btc(&t.env), &(90 * PRECISION), &(90 * PRECISION), &0, &0);
        // 120 side-OI exceeds the absolute 100 even though it's under the bps 250.
        let over = t.vault.try_reserve_for_position(&btc(&t.env), &(30 * PRECISION), &(120 * PRECISION), &0, &0);
        assert!(matches!(over, Err(Ok(NoetherError::OpenInterestCapExceeded))));

        // View reflects the effective (absolute-bound) cap.
        let (cap_bps, cap_abs, _skew, effective) = t.vault.get_asset_caps(&btc(&t.env));
        assert_eq!(cap_bps, 2_500);
        assert_eq!(cap_abs, 100 * PRECISION);
        assert_eq!(effective, 100 * PRECISION);
    }

    #[test]
    fn skew_cap_rejects_worsening_open_but_allows_reducing() {
        let t = setup(1_000 * PRECISION);
        t.vault.set_asset_cap(&btc(&t.env), &10_000); // lift OI cap out of the way
        t.vault.set_skew_cap(&btc(&t.env), &1_000); // 10% of ~1000 AUM = ~100

        // A worsening open past the skew cap (net 0 → 150) is rejected #89.
        let worse = t.vault.try_reserve_for_position(
            &btc(&t.env), &(150 * PRECISION), &(150 * PRECISION), &0, &(150 * PRECISION),
        );
        assert!(matches!(worse, Err(Ok(NoetherError::SkewCapExceeded))));

        // A skew-REDUCING open (net 200 → 120, both over the cap) is ALLOWED —
        // the trade that helps must never be blocked.
        t.vault.reserve_for_position(
            &btc(&t.env), &(80 * PRECISION), &(80 * PRECISION), &(200 * PRECISION), &(120 * PRECISION),
        );
        assert_eq!(t.vault.get_reserved_payout(), 80 * PRECISION);
    }

    #[test]
    fn skew_cap_default_absent_config_is_bps_only() {
        let t = setup(1_000 * PRECISION);
        // No absolute cap, default skew cap: a skew-neutral reserve just works.
        t.vault.reserve_for_position(&btc(&t.env), &(100 * PRECISION), &(100 * PRECISION), &0, &0);
        let (_, cap_abs, skew_bps, _) = t.vault.get_asset_caps(&btc(&t.env));
        assert_eq!(cap_abs, 0); // no absolute bound by default
        assert_eq!(skew_bps, 1_500); // default 15%
    }

    #[test]
    fn cap_setters_are_admin_only_and_validated() {
        let t = setup(1_000 * PRECISION);
        // Negative absolute cap rejected.
        assert!(matches!(
            t.vault.try_set_asset_cap_abs(&btc(&t.env), &(-1)),
            Err(Ok(NoetherError::InvalidParameter))
        ));
        // Zero / over-range skew bps rejected.
        assert!(matches!(t.vault.try_set_skew_cap(&btc(&t.env), &0), Err(Ok(NoetherError::InvalidParameter))));
        assert!(matches!(t.vault.try_set_skew_cap(&btc(&t.env), &10_001), Err(Ok(NoetherError::InvalidParameter))));
        // Non-admin rejected.
        t.env.set_auths(&[]);
        assert!(t.vault.try_set_asset_cap_abs(&btc(&t.env), &(100 * PRECISION)).is_err());
    }

    #[test]
    fn withdraw_cannot_undercut_reserved_payouts() {
        let t = setup(1_000 * PRECISION);
        t.vault.set_asset_cap(&btc(&t.env), &10_000);
        t.vault
            .reserve_for_position(&btc(&t.env), &(600 * PRECISION), &(600 * PRECISION), &0, &0);

        let noe = t.vault.get_noe_balance(&t.lp);
        t.env.ledger().with_mut(|l| l.timestamp += 1_800); // L1-28: clear cooldown
        approve_noe(&t, noe);
        // Withdrawing everything would leave less than the 600 reserved
        let blocked = t.vault.try_withdraw(&t.lp, &noe, &0);
        assert!(matches!(blocked, Err(Ok(NoetherError::InsufficientLiquidity))));

        // A small withdrawal that keeps the reservation covered is fine
        let small = t.vault.withdraw(&t.lp, &(noe / 10), &0);
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
        market_inflow(&t, 30 * PRECISION);
        t.vault.fund_buffer(&(30 * PRECISION));
        assert_eq!(t.vault.get_shortfall_reserve(), 15 * PRECISION);
        assert_eq!(t.vault.get_buffer_balance(), 15 * PRECISION);

        // Next inflow: unreserved owed is only 5 — the split caps there.
        market_inflow(&t, 30 * PRECISION);
        t.vault.fund_buffer(&(30 * PRECISION));
        assert_eq!(t.vault.get_shortfall_reserve(), 20 * PRECISION);
        assert_eq!(t.vault.get_buffer_balance(), 40 * PRECISION);

        // Fully reserved: everything flows to the buffer now.
        market_inflow(&t, 10 * PRECISION);
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
        market_inflow(&t, 20 * PRECISION);
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
        market_inflow(&t, 10 * PRECISION);
        t.vault.fund_buffer(&(10 * PRECISION));
        StellarAssetClient::new(&t.env, &t.usdc).mint(&t.vault_id, &(10 * PRECISION));
        let first = t.vault.claim_shortfall(&w);
        assert_eq!(first, 10 * PRECISION);
        assert_eq!(t.vault.get_shortfall_owed(&w), 10 * PRECISION);
        assert_eq!(t.vault.get_shortfall(), 10 * PRECISION);

        // Next inflow amortizes the rest.
        market_inflow(&t, 20 * PRECISION);
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

        // Refill the drained pool the realistic way — a trader loss lands 100
        // USDC back in — so the LP's existing shares regain value. (A fresh
        // deposit is intentionally NOT used here: the dead-pool guard blocks
        // minting 1:1 while AUM is 0.) Then fabricate the earmark DIRECTLY in
        // storage, deliberately unbacked: R-4 blocks building this drifted
        // state through fund_buffer, but the withdraw floor must still bind
        // against the SAME USDC the LP wants to withdraw if books ever drift.
        StellarAssetClient::new(&t.env, &t.usdc).mint(&t.vault_id, &(100 * PRECISION));
        t.vault.receive_loss(&(100 * PRECISION));
        t.env.as_contract(&t.vault_id, || {
            storage::set_shortfall_reserve(&t.env, 20 * PRECISION);
            set_buffer_balance(&t.env, get_buffer_balance(&t.env) + 20 * PRECISION);
        });
        assert_eq!(t.vault.get_shortfall_reserve(), 20 * PRECISION);

        // Withdrawing EVERYTHING would strip the earmarked 20 — blocked.
        let noe = t.vault.get_noe_balance(&t.lp);
        t.env.ledger().with_mut(|l| l.timestamp += 1_800); // L1-28: clear cooldown
        approve_noe(&t, noe);
        let blocked = t.vault.try_withdraw(&t.lp, &noe, &0);
        assert!(matches!(blocked, Err(Ok(NoetherError::InsufficientLiquidity))));

        // A partial withdrawal that leaves the reserve covered is fine.
        let small = t.vault.withdraw(&t.lp, &(noe / 4), &0);
        assert!(small > 0);
    }

    /// R-6: LP slippage bounds + the global principal cap.
    #[test]
    fn min_out_bounds_and_aum_cap_enforced() {
        let t = setup(1_000 * PRECISION);

        // Deposit demanding more NOE than the mint yields → slippage error.
        assert!(matches!(
            t.vault.try_deposit(&t.lp, &(100 * PRECISION), &(101 * PRECISION)),
            Err(Ok(NoetherError::InvalidSlippageTolerance))
        ));
        // A satisfiable bound passes (par pool → 1:1 mint).
        let minted = t.vault.deposit(&t.lp, &(100 * PRECISION), &(100 * PRECISION));
        assert_eq!(minted, 100 * PRECISION);

        // Withdraw demanding more USDC than the burn returns → slippage error.
        t.env.ledger().with_mut(|l| l.timestamp += 1_800); // L1-28 cooldown
        approve_noe(&t, 100 * PRECISION);
        assert!(matches!(
            t.vault.try_withdraw(&t.lp, &(50 * PRECISION), &(51 * PRECISION)),
            Err(Ok(NoetherError::InvalidSlippageTolerance))
        ));
        let out = t.vault.withdraw(&t.lp, &(50 * PRECISION), &(50 * PRECISION));
        assert_eq!(out, 50 * PRECISION);

        // Global principal cap: total_usdc is now 1050. Cap 1060 → a 20
        // deposit (net, zero fees in this fixture) must bounce; 10 fits.
        t.vault.set_aum_cap(&(1_060 * PRECISION));
        assert!(matches!(
            t.vault.try_deposit(&t.lp, &(20 * PRECISION), &0),
            Err(Ok(NoetherError::DepositCapExceeded))
        ));
        t.vault.deposit(&t.lp, &(10 * PRECISION), &0);
        // cap = 0 lifts the limit.
        t.vault.set_aum_cap(&0);
        t.vault.deposit(&t.lp, &(20 * PRECISION), &0);
    }

    /// R-4: crediting without a matching USDC transfer must fail closed —
    /// the receipt check refuses to book phantom assets.
    #[test]
    fn unbacked_market_credits_are_refused() {
        let t = setup(100 * PRECISION);
        // No transfer precedes either call → InsufficientBalance.
        assert!(matches!(
            t.vault.try_receive_loss(&(10 * PRECISION)),
            Err(Ok(NoetherError::InsufficientBalance))
        ));
        assert!(matches!(
            t.vault.try_fund_buffer(&(10 * PRECISION)),
            Err(Ok(NoetherError::InsufficientBalance))
        ));
        // A backed credit still lands.
        market_inflow(&t, 10 * PRECISION);
        t.vault.receive_loss(&(10 * PRECISION));
    }

    #[test]
    fn claim_works_while_paused() {
        let t = setup(10 * PRECISION);
        let w = Address::generate(&t.env);
        t.vault.settle_pnl(&w, &(30 * PRECISION)); // owed 20
        market_inflow(&t, 20 * PRECISION);
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
        market_inflow(&t, 50 * PRECISION);
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
        market_inflow(&t, 10 * PRECISION);
        t.vault.fund_buffer(&(10 * PRECISION));

        let covered = t.vault.draw_buffer(&(35 * PRECISION));
        assert_eq!(covered, 10 * PRECISION);
        assert_eq!(t.vault.get_buffer_balance(), 0);
        assert_eq!(t.vault.get_cum_bad_debt_covered(), 10 * PRECISION);
        assert_eq!(t.vault.get_cum_bad_debt_lp_absorbed(), 25 * PRECISION);
    }

    #[test]
    fn pay_from_buffer_market_only_auth() {
        let t = setup(100 * PRECISION);
        market_inflow(&t, 10 * PRECISION);
        t.vault.fund_buffer(&(10 * PRECISION));
        let someone = Address::generate(&t.env);
        t.env.set_auths(&[]);
        assert!(t.vault.try_pay_from_buffer(&someone, &PRECISION).is_err());
    }

    #[test]
    fn pay_from_buffer_caps_at_spendable_buffer() {
        let t = setup(100 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&t.env, &t.usdc);
        let to = Address::generate(&t.env);
        market_inflow(&t, 10 * PRECISION);
        t.vault.fund_buffer(&(10 * PRECISION));
        StellarAssetClient::new(&t.env, &t.usdc).mint(&t.vault_id, &(10 * PRECISION));

        // Request 25 with a 10 buffer: pays exactly the buffer.
        let paid = t.vault.pay_from_buffer(&to, &(25 * PRECISION));
        assert_eq!(paid, 10 * PRECISION);
        assert_eq!(usdc.balance(&to), 10 * PRECISION);
        assert_eq!(t.vault.get_buffer_balance(), 0);
    }

    #[test]
    fn draw_buffer_market_only_auth() {
        let t = setup(100 * PRECISION);
        market_inflow(&t, 10 * PRECISION);
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
        market_inflow(&t, 20 * PRECISION);
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
        t.vault.deposit(&t.lp, &(300 * PRECISION), &0);
        assert_eq!(t.vault.get_deposited(&t.lp), 300 * PRECISION);

        // A second deposit crossing the cap is rejected.
        let over = t.vault.try_deposit(&t.lp, &(300 * PRECISION), &0);
        assert_eq!(over, Err(Ok(NoetherError::DepositCapExceeded)));

        // Exactly hitting the cap is allowed.
        t.vault.deposit(&t.lp, &(200 * PRECISION), &0);
        assert_eq!(t.vault.get_deposited(&t.lp), 500 * PRECISION);

        // Cap = 0 disables the limit.
        t.vault.set_deposit_cap(&0);
        let ok = t.vault.deposit(&t.lp, &(1_000 * PRECISION), &0);
        assert!(ok > 0);
    }

    // ── Footprint stability (2026-08-30): the set of keys a settlement
    // writes must not depend on transient balances. A zero-delta path still
    // writes the key back, so a simulation never records it read-only.

    fn vault_has(t: &VaultTest, key: DataKey) -> bool {
        t.env.as_contract(&t.vault_id, || t.env.storage().persistent().has(&key))
    }

    #[test]
    fn settle_pnl_writes_buffer_and_buckets_even_on_a_zero_draw() {
        let t = setup(1_000 * PRECISION);
        // Fresh vault: nothing has ever touched the buffer entry.
        assert!(!vault_has(&t, DataKey::BufferBalance));
        let trader = Address::generate(&t.env);
        // Winner paid entirely from LP value: from_buffer == 0.
        let paid = t.vault.settle_pnl(&trader, &(10 * PRECISION));
        assert_eq!(paid, 10 * PRECISION);
        assert!(vault_has(&t, DataKey::BufferBalance), "zero draw must still write BufferBalance");
        assert_eq!(t.vault.get_buffer_balance(), 0);
        assert!(vault_has(&t, DataKey::TotalFees));
        assert!(vault_has(&t, DataKey::ShortfallReserve));
        assert_eq!(t.vault.get_total_usdc(), 990 * PRECISION);
    }

    #[test]
    fn receive_loss_touches_the_buckets_the_win_path_writes() {
        let t = setup(1_000 * PRECISION);
        assert!(!vault_has(&t, DataKey::BufferBalance));
        market_inflow(&t, 5 * PRECISION);
        t.vault.receive_loss(&(5 * PRECISION));
        assert!(vault_has(&t, DataKey::BufferBalance));
        assert!(vault_has(&t, DataKey::TotalFees));
        assert!(vault_has(&t, DataKey::ShortfallReserve));
        assert_eq!(t.vault.get_buffer_balance(), 0);
        assert_eq!(t.vault.get_total_usdc(), 1_005 * PRECISION);
    }

    #[test]
    fn settle_pnl_writes_the_shortfall_books_on_a_fully_covered_win() {
        let t = setup(1_000 * PRECISION);
        let trader = Address::generate(&t.env);
        assert!(!vault_has(&t, DataKey::ShortfallOwed(trader.clone())));
        assert!(!vault_has(&t, DataKey::Shortfall));
        assert!(!vault_has(&t, DataKey::CumShortfall));
        // Covered in full: nothing is booked, but every key the booking
        // path writes must already be in the footprint.
        assert_eq!(t.vault.settle_pnl(&trader, &(10 * PRECISION)), 10 * PRECISION);
        assert!(vault_has(&t, DataKey::ShortfallOwed(trader.clone())));
        assert!(vault_has(&t, DataKey::Shortfall));
        assert!(vault_has(&t, DataKey::CumShortfall));
        assert_eq!(t.vault.get_shortfall_owed(&trader), 0);
        assert_eq!(t.vault.get_shortfall(), 0);
        assert_eq!(t.vault.get_cum_shortfall(), 0);
        // And a loss carries the same key set (sign flips between simulate
        // and apply must not change what settle_pnl writes).
        let loser = Address::generate(&t.env);
        t.vault.settle_pnl(&loser, &(-(5 * PRECISION)));
        assert!(vault_has(&t, DataKey::ShortfallOwed(loser.clone())));
    }

    #[test]
    fn route_protocol_fee_writes_the_buffer_even_when_it_all_overflows() {
        // Empty book → target 0 → nothing goes to the buffer, everything to
        // the treasury; the buffer key must still be written.
        let t = setup(1_000 * PRECISION);
        let treasury = Address::generate(&t.env);
        market_inflow(&t, PRECISION);
        assert!(!vault_has(&t, DataKey::BufferBalance));
        t.vault.route_protocol_fee(&PRECISION, &treasury);
        assert!(vault_has(&t, DataKey::BufferBalance));
        assert_eq!(t.vault.get_buffer_balance(), 0);
        assert_eq!(soroban_sdk::token::Client::new(&t.env, &t.usdc).balance(&treasury), PRECISION);
    }

    #[test]
    fn draw_buffer_and_pay_bounty_write_back_on_the_zero_path() {
        let t = setup(1_000 * PRECISION);
        let keeper = Address::generate(&t.env);
        assert!(!vault_has(&t, DataKey::BufferBalance));
        assert_eq!(t.vault.pay_bounty(&keeper, &PRECISION), 0);
        assert!(vault_has(&t, DataKey::BufferBalance));
        assert_eq!(t.vault.draw_buffer(&(3 * PRECISION)), 0);
        assert_eq!(t.vault.get_buffer_balance(), 0);
        assert_eq!(t.vault.get_total_usdc(), 1_000 * PRECISION);
    }

    #[test]
    fn fund_buffer_is_market_only() {
        let t = setup(100 * PRECISION);
        // Market-authed (mock_all_auths) works.
        market_inflow(&t, 10 * PRECISION);
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
            .try_reserve_for_position(&btc(&t.env), &PRECISION, &PRECISION, &0, &0)
            .is_err());
        assert!(t.vault.try_sync_exposure(&btc(&t.env), &0, &0).is_err());
        assert!(t.vault.try_receive_loss(&PRECISION).is_err());
        let _ = (&t.admin, &t.vault_id);
    }

    // ───────────────────────────────────────────────────────────────────
    // L0-15 · exit-only pause + timelocked recovery
    // ───────────────────────────────────────────────────────────────────

    #[test]
    fn test_paused_vault_blocks_deposit_allows_withdraw() {
        let t = setup(1_000 * PRECISION);
        let noe_bal = t.vault.get_noe_balance(&t.lp);
        t.vault.pause();

        // Deposits blocked …
        assert!(matches!(
            t.vault.try_deposit(&t.lp, &(100 * PRECISION), &0),
            Err(Ok(NoetherError::Paused))
        ));
        // … but LPs can ALWAYS exit (exit-only).
        t.env.ledger().with_mut(|l| l.timestamp += 1_800); // L1-28: clear cooldown
        approve_noe(&t, noe_bal);
        assert!(t.vault.withdraw(&t.lp, &noe_bal, &0) > 0);
    }

    #[test]
    fn test_paused_withdraw_still_respects_reserved_floor() {
        let t = setup(1_000 * PRECISION);
        let noe_bal = t.vault.get_noe_balance(&t.lp);
        // Reserve payout capacity, then pause.
        t.vault.reserve_for_position(&btc(&t.env), &(200 * PRECISION), &(200 * PRECISION), &0, &0);
        t.vault.pause();

        // A full exit would strip liquidity out from under the reservation —
        // blocked by the solvency floor (#40), NOT by pause.
        t.env.ledger().with_mut(|l| l.timestamp += 1_800); // L1-28: clear cooldown
        approve_noe(&t, noe_bal);
        assert!(matches!(
            t.vault.try_withdraw(&t.lp, &noe_bal, &0),
            Err(Ok(NoetherError::InsufficientLiquidity))
        ));
        // A small exit within free liquidity still works while paused.
        let small = noe_bal / 20;
        approve_noe(&t, small);
        assert!(t.vault.withdraw(&t.lp, &small, &0) > 0);
    }

    #[test]
    fn test_recovery_requires_48h_timelock() {
        let t = setup(1_000 * PRECISION);
        let dest = Address::generate(&t.env);
        t.vault.init_recovery(&dest);
        t.vault.pause();
        t.vault.propose_recovery(&(100 * PRECISION));

        // Before the timelock: rejected.
        assert!(matches!(
            t.vault.try_execute_recovery(),
            Err(Ok(NoetherError::InvalidParameter))
        ));
        // At +172_799s: still rejected (boundary).
        t.env.ledger().with_mut(|li| li.timestamp += 172_799);
        assert!(matches!(
            t.vault.try_execute_recovery(),
            Err(Ok(NoetherError::InvalidParameter))
        ));
        // At +172_800s: executes.
        t.env.ledger().with_mut(|li| li.timestamp += 1);
        t.vault.execute_recovery();
        assert!(t.vault.get_recovery_proposal().is_none(), "proposal cleared");
    }

    #[test]
    fn test_recovery_only_pays_declared_address() {
        let t = setup(1_000 * PRECISION);
        let dest = Address::generate(&t.env);
        t.vault.init_recovery(&dest);
        t.vault.pause();
        t.vault.propose_recovery(&(100 * PRECISION));
        t.env.ledger().with_mut(|li| li.timestamp += 172_800);

        let usdc = soroban_sdk::token::Client::new(&t.env, &t.usdc);
        let before = usdc.balance(&dest);
        t.vault.execute_recovery();
        // The pre-declared destination — and only it — receives the funds.
        assert_eq!(usdc.balance(&dest) - before, 100 * PRECISION);
    }

    #[test]
    fn test_unpause_cancels_recovery_proposal() {
        let t = setup(1_000 * PRECISION);
        let dest = Address::generate(&t.env);
        t.vault.init_recovery(&dest);
        t.vault.pause();
        t.vault.propose_recovery(&(100 * PRECISION));
        assert!(t.vault.get_recovery_proposal().is_some());

        // Leaving the emergency retracts the break-glass.
        t.vault.unpause();
        assert!(t.vault.get_recovery_proposal().is_none());
    }

    #[test]
    fn test_init_recovery_is_one_shot() {
        let t = setup(0);
        let dest = Address::generate(&t.env);
        t.vault.init_recovery(&dest);
        let dest2 = Address::generate(&t.env);
        assert!(matches!(
            t.vault.try_init_recovery(&dest2),
            Err(Ok(NoetherError::AlreadyInitialized))
        ));
        assert_eq!(t.vault.get_recovery_address(), Some(dest));
    }

    // ───────────────────────────────────────────────────────────────────
    // L1-28 · LP withdrawal cooldown (anti-JIT / NAV-sniping)
    // ───────────────────────────────────────────────────────────────────

    // ───────────────────────────────────────────────────────────────────
    // L1-23 · bankruptcy keeper bounty (pay_bounty)
    // ───────────────────────────────────────────────────────────────────

    #[test]
    fn bounty_capped_at_buffer() {
        let t = setup(0);
        let seeder = Address::generate(&t.env);
        StellarAssetClient::new(&t.env, &t.usdc).mint(&seeder, &(3 * PRECISION));
        t.vault.seed_buffer(&seeder, &(3 * PRECISION));
        assert_eq!(t.vault.get_buffer_balance(), 3 * PRECISION);

        // Request 5 but the buffer holds only 3 → pay 3, buffer drained.
        let keeper = Address::generate(&t.env);
        assert_eq!(t.vault.pay_bounty(&keeper, &(5 * PRECISION)), 3 * PRECISION);
        assert_eq!(t.vault.get_buffer_balance(), 0);
        assert_eq!(soroban_sdk::token::Client::new(&t.env, &t.usdc).balance(&keeper), 3 * PRECISION);
    }

    #[test]
    fn bounty_zero_buffer_returns_zero_never_errors() {
        let t = setup(0);
        let keeper = Address::generate(&t.env);
        assert_eq!(t.vault.pay_bounty(&keeper, &(5 * PRECISION)), 0); // dry → 0, no revert
    }

    // ───────────────────────────────────────────────────────────────────
    // Share-price / NAV accounting regressions (stellar-skills audit 2026-07-22)
    // ───────────────────────────────────────────────────────────────────

    #[test]
    fn deposit_fee_does_not_inflate_aum() {
        // 30 bps deposit fee, no withdraw fee, empty pool.
        let t = setup_with_fees(0, 30, 0);
        let usdc = soroban_sdk::token::Client::new(&t.env, &t.usdc);

        let gross = 1_000 * PRECISION;
        let fee = gross * 30 / 10_000;
        t.vault.deposit(&t.lp, &gross, &0);

        // Invariant: AUM must equal the vault's physical USDC — the fee is
        // retained earnings already inside the balance, not new value on top.
        // (Pre-fix the fee was double-counted, so AUM read gross + fee.)
        let physical = usdc.balance(&t.vault_id);
        assert_eq!(physical, gross);
        assert_eq!(t.vault.get_aum(), gross);
        // total_usdc tracks NET principal only; the fee lives in total_fees.
        assert_eq!(t.vault.get_total_usdc(), gross - fee);
    }

    #[test]
    fn deposit_blocked_when_pool_value_wiped() {
        // Live pool with NOE circulating, then traders' unrealized profit wipes
        // AUM to 0 (the reachable dead-share state).
        let t = setup(1_000 * PRECISION);
        t.vault.sync_exposure(&btc(&t.env), &(1_000 * PRECISION), &0);
        assert_eq!(t.vault.get_aum(), 0);

        // A new deposit must be refused, not minted 1:1 against dead shares.
        let r = t.vault.try_deposit(&t.lp, &(100 * PRECISION), &0);
        assert!(matches!(r, Err(Ok(NoetherError::InsufficientLiquidity))));
    }

    #[test]
    fn pay_bounty_never_spends_shortfall_reserve() {
        let t = setup(10 * PRECISION);
        let usdc = soroban_sdk::token::Client::new(&t.env, &t.usdc);
        let w = Address::generate(&t.env);

        // Winner takes 30 against a 10 pool → 10 paid, 20 booked as shortfall.
        t.vault.settle_pnl(&w, &(30 * PRECISION));
        // Fabricate the drifted buffer/reserve DIRECTLY (R-4 blocks building
        // an unbacked state through fund_buffer): reserve 15, buffer 15.
        t.env.as_contract(&t.vault_id, || {
            storage::set_shortfall_reserve(&t.env, 15 * PRECISION);
            set_buffer_balance(&t.env, get_buffer_balance(&t.env) + 15 * PRECISION);
        });
        // Back only 20 USDC of it physically. Spendable-for-bounty = 20 − 15 = 5,
        // even though the buffer accounting shows 15.
        StellarAssetClient::new(&t.env, &t.usdc).mint(&t.vault_id, &(20 * PRECISION));
        assert_eq!(t.vault.get_shortfall_reserve(), 15 * PRECISION);
        assert_eq!(t.vault.get_buffer_balance(), 15 * PRECISION);

        let keeper = Address::generate(&t.env);
        // Request 10: buffer (15) would allow it, but the 15 earmarked for
        // shortfall claimants caps the physically-spendable amount at 5.
        let paid = t.vault.pay_bounty(&keeper, &(10 * PRECISION));
        assert_eq!(paid, 5 * PRECISION);
        assert_eq!(usdc.balance(&keeper), 5 * PRECISION);
        // The reserve's USDC is still physically present for the claimant.
        assert_eq!(usdc.balance(&t.vault_id), 15 * PRECISION);
        assert_eq!(t.vault.get_shortfall_reserve(), 15 * PRECISION);
    }

    #[test]
    fn reserve_for_position_excludes_earmarked_shortfall_reserve() {
        let t = setup(0);
        let w = Address::generate(&t.env);

        // Large outstanding shortfall so the earmarked reserve can exceed the
        // small physical balance rebuilt below.
        t.vault.settle_pnl(&w, &(1_000 * PRECISION)); // owed 1000, paid 0

        // Rebuild a small real balance / AUM via a trader loss (not a deposit,
        // which the dead-pool guard would now block): 100 USDC in.
        StellarAssetClient::new(&t.env, &t.usdc).mint(&t.vault_id, &(100 * PRECISION));
        t.vault.receive_loss(&(100 * PRECISION)); // total_usdc 100, AUM 100
        t.vault.set_asset_cap(&btc(&t.env), &10_000); // lift OI cap out of the way

        // Fabricate the drifted earmark DIRECTLY (R-4 blocks building an
        // unbacked state through fund_buffer): reserve 1000, buffer 1000.
        t.env.as_contract(&t.vault_id, || {
            storage::set_shortfall_reserve(&t.env, 1_000 * PRECISION);
            set_buffer_balance(&t.env, get_buffer_balance(&t.env) + 1_000 * PRECISION);
        });
        assert_eq!(t.vault.get_shortfall_reserve(), 1_000 * PRECISION);

        // Physical balance is 100 but 1000 is earmarked for shortfall claimants,
        // so ZERO is available to back a new reservation. Even a 10-USDC reserve
        // (well under the OI cap) must be refused.
        let r = t.vault.try_reserve_for_position(
            &btc(&t.env),
            &(10 * PRECISION),
            &(10 * PRECISION),
            &0,
            &0,
        );
        assert!(matches!(r, Err(Ok(NoetherError::InsufficientLiquidity))));
    }

    // ───────────────────────────────────────────────────────────────────
    // L1-22 · insurance-buffer target + protocol-fee stream
    // ───────────────────────────────────────────────────────────────────

    #[test]
    fn protocol_fee_fills_buffer_to_target_then_overflows() {
        let t = setup(1_000 * PRECISION);
        // Reserve payout so the buffer target is nonzero: 200 × 10% = 20 USDC.
        t.vault.reserve_for_position(&btc(&t.env), &(200 * PRECISION), &(200 * PRECISION), &0, &0);
        let treasury = Address::generate(&t.env);
        let usdc = soroban_sdk::token::Client::new(&t.env, &t.usdc);
        // The market pre-transfers the fee into the vault; simulate with a mint.
        StellarAssetClient::new(&t.env, &t.usdc).mint(&t.vault_id, &(30 * PRECISION));

        // Route 30: 20 fills the buffer to target, 10 overflows to treasury.
        t.vault.route_protocol_fee(&(30 * PRECISION), &treasury);
        assert_eq!(t.vault.get_buffer_balance(), 20 * PRECISION);
        assert_eq!(usdc.balance(&treasury), 10 * PRECISION);

        // Already at target → a further fee overflows entirely.
        StellarAssetClient::new(&t.env, &t.usdc).mint(&t.vault_id, &(7 * PRECISION));
        t.vault.route_protocol_fee(&(7 * PRECISION), &treasury);
        assert_eq!(t.vault.get_buffer_balance(), 20 * PRECISION, "buffer stays at target");
        assert_eq!(usdc.balance(&treasury), 17 * PRECISION);
    }

    #[test]
    fn set_buffer_target_capped() {
        let t = setup(0);
        assert!(matches!(
            t.vault.try_set_buffer_target(&10_001u32),
            Err(Ok(NoetherError::InvalidParameter))
        ));
        t.vault.set_buffer_target(&2_000u32);
        assert_eq!(t.vault.get_buffer_target_bps(), 2_000);
    }

    #[test]
    fn withdraw_inside_cooldown_rejected_93() {
        let t = setup(0);
        t.vault.deposit(&t.lp, &(1_000 * PRECISION), &0);
        let noe = t.vault.get_noe_balance(&t.lp);
        approve_noe(&t, noe);
        assert!(matches!(
            t.vault.try_withdraw(&t.lp, &noe, &0),
            Err(Ok(NoetherError::WithdrawCooldownActive))
        ));
    }

    #[test]
    fn withdraw_after_cooldown_succeeds() {
        let t = setup(0);
        t.vault.deposit(&t.lp, &(1_000 * PRECISION), &0);
        let noe = t.vault.get_noe_balance(&t.lp);
        t.env.ledger().with_mut(|l| l.timestamp += 1_800); // exactly the window
        approve_noe(&t, noe);
        assert!(t.vault.withdraw(&t.lp, &noe, &0) > 0);
    }

    #[test]
    fn second_deposit_resets_cooldown() {
        let t = setup(0);
        t.vault.deposit(&t.lp, &(500 * PRECISION), &0);
        t.env.ledger().with_mut(|l| l.timestamp += 1_800); // first window elapsed
        t.vault.deposit(&t.lp, &(500 * PRECISION), &0); // re-arms the clock
        let noe = t.vault.get_noe_balance(&t.lp);
        approve_noe(&t, noe);
        assert!(matches!(
            t.vault.try_withdraw(&t.lp, &noe, &0),
            Err(Ok(NoetherError::WithdrawCooldownActive))
        ));
    }

    #[test]
    fn cooldown_zero_disables_gate() {
        let t = setup(0);
        t.vault.set_withdraw_cooldown(&0u64);
        t.vault.deposit(&t.lp, &(1_000 * PRECISION), &0);
        let noe = t.vault.get_noe_balance(&t.lp);
        approve_noe(&t, noe);
        assert!(t.vault.withdraw(&t.lp, &noe, &0) > 0); // instant when disabled
    }

    #[test]
    fn pre_upgrade_depositor_exempt() {
        // An address that never deposited post-upgrade (last==0) is exempt —
        // simulated by receiving NOE via transfer, not deposit.
        let t = setup(0);
        t.vault.deposit(&t.lp, &(1_000 * PRECISION), &0);
        let noe = t.vault.get_noe_balance(&t.lp);
        let lp2 = Address::generate(&t.env);
        let noe_client = soroban_sdk::token::Client::new(&t.env, &t.noe);
        noe_client.transfer(&t.lp, &lp2, &noe); // lp2 never deposited
        noe_client.approve(&lp2, &t.vault_id, &noe, &1_000_000);
        assert!(t.vault.withdraw(&lp2, &noe, &0) > 0); // immediate — last==0 exempt
    }

    #[test]
    fn set_withdraw_cooldown_capped() {
        let t = setup(0);
        assert!(matches!(
            t.vault.try_set_withdraw_cooldown(&86_401u64),
            Err(Ok(NoetherError::InvalidParameter))
        ));
        t.vault.set_withdraw_cooldown(&3_600u64);
        assert_eq!(t.vault.get_withdraw_cooldown(), 3_600);
    }

    #[test]
    fn cooldown_composes_with_reserved_payout_floor() {
        // After the cooldown elapses, a full exit still hits the ReservedPayout
        // floor (#40) — the two gates compose (cooldown first, then solvency).
        let t = setup(1_000 * PRECISION);
        t.vault.reserve_for_position(&btc(&t.env), &(200 * PRECISION), &(200 * PRECISION), &0, &0);
        t.env.ledger().with_mut(|l| l.timestamp += 1_800); // clear the cooldown
        let noe = t.vault.get_noe_balance(&t.lp);
        approve_noe(&t, noe);
        assert!(matches!(
            t.vault.try_withdraw(&t.lp, &noe, &0),
            Err(Ok(NoetherError::InsufficientLiquidity))
        ));
    }
}
