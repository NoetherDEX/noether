//! # Referral Contract
//!
//! Tranche 2 deliverable D4 (referral half) — on-chain referral system.
//!
//! - Users above a configurable trading-volume threshold can mint a
//!   unique short code.
//! - New users register with someone else's code via `set_referrer`.
//!   They receive a `discount_bps` reduction on every fee they pay.
//! - The market contract calls `record_trade(referee, fee_paid)` on
//!   every fee-bearing event; this contract increments the referrer's
//!   claimable balance by `referrer_share_bps` × fee.
//! - Referrers `claim()` whenever they like; the market contract pays
//!   out from its own USDC reserve.
//!
//! Phase 11.1 — crate scaffold only. Public surface is staged across
//! the next commits in this branch.

#![no_std]
// Amounts use the <units>_<7 decimals> grouping (10_000_0000000 = 10k USDC)
#![allow(clippy::inconsistent_digit_grouping)]

use soroban_sdk::{
    contract, contractimpl, token, Address, BytesN, Env, IntoVal, String, Symbol, Val, Vec,
};

mod storage;
mod types;

pub use types::{
    ReferralError, ReferralInfo, CODE_MAX_LEN, CODE_MIN_LEN, DEFAULT_DISCOUNT_BPS,
    DEFAULT_MIN_CODE_VOLUME, DEFAULT_REFERRER_SHARE_BPS, MAX_BPS,
};

#[contract]
pub struct ReferralContract;

#[contractimpl]
impl ReferralContract {
    pub fn version(env: Env) -> Symbol {
        Symbol::new(&env, "referral_v1")
    }

    /// One-shot initialisation. The market contract address is the only
    /// principal allowed to call `record_trade`; usdc_token is what the
    /// funded `claim` pays out in (L1-18). Discount and share are in basis
    /// points; min_code_volume is the 14-day rolling volume floor needed
    /// to mint a code (cross-read from the market at create_code).
    pub fn initialize(
        env: Env,
        admin: Address,
        market: Address,
        usdc_token: Address,
    ) -> Result<(), ReferralError> {
        if storage::is_initialized(&env) {
            return Err(ReferralError::AlreadyInitialized);
        }
        admin.require_auth();
        storage::set_admin(&env, &admin);
        storage::set_market(&env, &market);
        storage::set_usdc_token(&env, &usdc_token);
        storage::set_discount_bps(&env, DEFAULT_DISCOUNT_BPS);
        storage::set_referrer_share_bps(&env, DEFAULT_REFERRER_SHARE_BPS);
        storage::set_min_code_volume(&env, DEFAULT_MIN_CODE_VOLUME);
        storage::set_initialized(&env);
        storage::extend_instance_ttl(&env);
        env.events()
            .publish((Symbol::new(&env, "initialized"),), (admin, market));
        Ok(())
    }

    /// Mint a unique referral code for `referrer`. Each address can hold
    /// at most one code; codes are case-sensitive 3..=16 char strings.
    ///
    /// Volume gating (L1-18/R-3): the referrer's 14-day rolling volume is
    /// cross-read from market.get_trader_volume and must be at least
    /// MinCodeVolume. Fail-closed: an unreadable market counts as zero
    /// volume (admin can set the floor to 0 to disable the gate).
    pub fn create_code(
        env: Env,
        referrer: Address,
        code: String,
    ) -> Result<(), ReferralError> {
        storage::require_initialized(&env)?;
        referrer.require_auth();
        if storage::is_paused(&env) {
            return Err(ReferralError::RegistryPaused);
        }

        let min_volume = storage::get_min_code_volume(&env);
        if min_volume > 0 {
            let market = storage::get_market(&env);
            if Self::trader_volume_at_market(&env, &market, &referrer) < min_volume {
                return Err(ReferralError::InsufficientVolume);
            }
        }

        let len = code.len();
        if len < CODE_MIN_LEN {
            return Err(ReferralError::CodeTooShort);
        }
        if len > CODE_MAX_LEN {
            return Err(ReferralError::CodeTooLong);
        }
        if storage::code_taken(&env, &code) {
            return Err(ReferralError::CodeAlreadyTaken);
        }
        if storage::load_info(&env, &referrer).is_some() {
            return Err(ReferralError::AlreadyHasCode);
        }

        let info = ReferralInfo {
            code: code.clone(),
            referrer: referrer.clone(),
            created_at: env.ledger().timestamp(),
            referred_count: 0,
            total_volume_generated: 0,
            total_earned: 0,
            claimable: 0,
        };
        storage::save_info(&env, &info);
        storage::assign_code(&env, &code, &referrer);
        storage::extend_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "code_created"),),
            (referrer, code),
        );
        Ok(())
    }

    /// Bind a referee to a referrer's code. Single-shot per referee:
    /// once bound, the relationship is permanent. Self-referral is
    /// rejected. Increments the referrer's referred_count.
    pub fn set_referrer(
        env: Env,
        referee: Address,
        code: String,
    ) -> Result<(), ReferralError> {
        storage::require_initialized(&env)?;
        referee.require_auth();
        if storage::is_paused(&env) {
            return Err(ReferralError::RegistryPaused);
        }
        if storage::referrer_of(&env, &referee).is_some() {
            return Err(ReferralError::AlreadyHasReferrer);
        }
        let referrer = storage::lookup_code(&env, &code).ok_or(ReferralError::UnknownCode)?;
        if referrer == referee {
            return Err(ReferralError::SelfReferral);
        }
        if storage::is_revoked(&env, &referrer) {
            return Err(ReferralError::RevokedCode);
        }
        storage::set_referrer_of(&env, &referee, &referrer);
        let mut info = storage::load_info(&env, &referrer).ok_or(ReferralError::UnknownCode)?;
        info.referred_count = info.referred_count.checked_add(1).ok_or(ReferralError::Overflow)?;
        storage::save_info(&env, &info);
        env.events().publish(
            (Symbol::new(&env, "referrer_set"),),
            (referee, referrer, code),
        );
        Ok(())
    }

    /// Market-only hook called whenever a fee-bearing event happens.
    /// Returns (referee_discount, referrer_payout) — the market
    /// applies the discount to the referee's fee and transfers the
    /// payout to this contract, which then accrues against the
    /// referrer's claimable balance.
    ///
    /// For referees with no referrer this is a no-op returning (0, 0)
    /// so the market doesn't have to branch.
    pub fn record_trade(
        env: Env,
        referee: Address,
        original_fee: i128,
        volume: i128,
    ) -> Result<(i128, i128), ReferralError> {
        storage::require_market(&env)?;
        if original_fee <= 0 || storage::is_paused(&env) {
            return Ok((0, 0));
        }
        let referrer = match storage::referrer_of(&env, &referee) {
            Some(addr) => addr,
            None => return Ok((0, 0)),
        };
        // A revoked referrer accrues nothing — the market charges the
        // full fee (L1-18/R-5).
        if storage::is_revoked(&env, &referrer) {
            return Ok((0, 0));
        }

        let discount_bps = storage::get_discount_bps(&env);
        let share_bps = storage::get_referrer_share_bps(&env);
        let discount = original_fee
            .checked_mul(discount_bps as i128)
            .ok_or(ReferralError::Overflow)?
            / 10_000;
        let payout = original_fee
            .checked_mul(share_bps as i128)
            .ok_or(ReferralError::Overflow)?
            / 10_000;

        let mut info = storage::load_info(&env, &referrer).ok_or(ReferralError::UnknownCode)?;
        // R-8 fix: this stat is VOLUME generated, not fees generated.
        info.total_volume_generated = info
            .total_volume_generated
            .checked_add(if volume > 0 { volume } else { 0 })
            .ok_or(ReferralError::Overflow)?;
        info.total_earned = info
            .total_earned
            .checked_add(payout)
            .ok_or(ReferralError::Overflow)?;
        info.claimable = info
            .claimable
            .checked_add(payout)
            .ok_or(ReferralError::Overflow)?;
        storage::save_info(&env, &info);

        env.events().publish(
            (Symbol::new(&env, "trade_recorded"),),
            (referee, referrer, original_fee, discount, payout, volume),
        );
        Ok((discount, payout))
    }

    /// Funded claim (L1-18): transfers the claimable balance from THIS
    /// contract's own USDC (push-funded by the market's per-trade pot
    /// transfers) to the referrer. If the balance cannot cover it, the
    /// claim rejects with ClaimUnfunded and claimable is PRESERVED —
    /// an earned balance is never burned. Deliberately not pause-gated
    /// (claims are exits).
    pub fn claim(env: Env, referrer: Address) -> Result<i128, ReferralError> {
        storage::require_initialized(&env)?;
        referrer.require_auth();
        let mut info = storage::load_info(&env, &referrer).ok_or(ReferralError::UnknownCode)?;
        let amount = info.claimable;
        if amount <= 0 {
            return Err(ReferralError::NothingToClaim);
        }

        let usdc = storage::get_usdc_token(&env).ok_or(ReferralError::ClaimUnfunded)?;
        let client = token::Client::new(&env, &usdc);
        let this = env.current_contract_address();
        if client.balance(&this) < amount {
            return Err(ReferralError::ClaimUnfunded);
        }
        client.transfer(&this, &referrer, &amount);

        info.claimable = 0;
        storage::save_info(&env, &info);
        env.events()
            .publish((Symbol::new(&env, "claimed"),), (referrer, amount));
        Ok(amount)
    }

    /// Public view: returns the referrer bound to `referee`, or None.
    pub fn get_referrer(env: Env, referee: Address) -> Option<Address> {
        storage::referrer_of(&env, &referee)
    }

    // ───────────────────────────────────────────────────────────────────
    // View functions
    // ───────────────────────────────────────────────────────────────────

    pub fn get_info(env: Env, referrer: Address) -> Result<ReferralInfo, ReferralError> {
        storage::require_initialized(&env)?;
        storage::load_info(&env, &referrer).ok_or(ReferralError::UnknownCode)
    }

    pub fn resolve_code(env: Env, code: String) -> Option<Address> {
        storage::lookup_code(&env, &code)
    }

    pub fn get_admin(env: Env) -> Result<Address, ReferralError> {
        storage::require_initialized(&env)?;
        Ok(storage::get_admin(&env))
    }

    pub fn get_market(env: Env) -> Result<Address, ReferralError> {
        storage::require_initialized(&env)?;
        Ok(storage::get_market(&env))
    }

    pub fn get_config(env: Env) -> Result<(u32, u32, i128), ReferralError> {
        storage::require_initialized(&env)?;
        Ok((
            storage::get_discount_bps(&env),
            storage::get_referrer_share_bps(&env),
            storage::get_min_code_volume(&env),
        ))
    }

    // ───────────────────────────────────────────────────────────────────
    // Admin tuning
    // ───────────────────────────────────────────────────────────────────

    pub fn set_discount_bps(env: Env, bps: u32) -> Result<(), ReferralError> {
        storage::require_admin(&env)?;
        if bps > MAX_BPS {
            return Err(ReferralError::InvalidParameter);
        }
        storage::set_discount_bps(&env, bps);
        Ok(())
    }

    pub fn set_referrer_share_bps(env: Env, bps: u32) -> Result<(), ReferralError> {
        storage::require_admin(&env)?;
        if bps > MAX_BPS {
            return Err(ReferralError::InvalidParameter);
        }
        storage::set_referrer_share_bps(&env, bps);
        Ok(())
    }

    pub fn set_min_code_volume(env: Env, volume: i128) -> Result<(), ReferralError> {
        storage::require_admin(&env)?;
        if volume < 0 {
            return Err(ReferralError::InvalidParameter);
        }
        storage::set_min_code_volume(&env, volume);
        Ok(())
    }

    // ───────────────────────────────────────────────────────────────────
    // Admin controls (L1-18 / R-5)
    // ───────────────────────────────────────────────────────────────────

    /// Revoke a code's referrer: record_trade accrues (0,0) for them and
    /// the code takes no new bindings. Reversible via unrevoke.
    pub fn revoke_code(env: Env, code: String) -> Result<(), ReferralError> {
        storage::require_admin(&env)?;
        let referrer = storage::lookup_code(&env, &code).ok_or(ReferralError::UnknownCode)?;
        storage::set_revoked(&env, &referrer, true);
        env.events()
            .publish((Symbol::new(&env, "code_revoked"),), (referrer, code));
        Ok(())
    }

    pub fn unrevoke_code(env: Env, code: String) -> Result<(), ReferralError> {
        storage::require_admin(&env)?;
        let referrer = storage::lookup_code(&env, &code).ok_or(ReferralError::UnknownCode)?;
        storage::set_revoked(&env, &referrer, false);
        env.events()
            .publish((Symbol::new(&env, "code_unrevoked"),), (referrer, code));
        Ok(())
    }

    /// Delete a referee's binding — future trades accrue nothing to the
    /// old referrer (self-referral cluster backstop).
    pub fn unbind(env: Env, referee: Address) -> Result<(), ReferralError> {
        storage::require_admin(&env)?;
        storage::remove_referrer_of(&env, &referee);
        env.events()
            .publish((Symbol::new(&env, "unbound"),), referee);
        Ok(())
    }

    /// Pause the registry: record_trade becomes a (0,0) no-op, new codes
    /// and bindings reject. Claims stay open (exits are never gated).
    pub fn set_paused(env: Env, paused: bool) -> Result<(), ReferralError> {
        storage::require_admin(&env)?;
        storage::set_paused(&env, paused);
        env.events()
            .publish((Symbol::new(&env, "registry_paused"),), paused);
        Ok(())
    }

    /// Re-point at a redeployed market without losing code/referrer state.
    pub fn set_market(env: Env, market: Address) -> Result<(), ReferralError> {
        storage::require_admin(&env)?;
        storage::set_market(&env, &market);
        Ok(())
    }

    pub fn set_usdc_token(env: Env, usdc: Address) -> Result<(), ReferralError> {
        storage::require_admin(&env)?;
        storage::set_usdc_token(&env, &usdc);
        Ok(())
    }

    /// Swap the running WASM in place; codes, bindings and balances are
    /// preserved (mirrors the market/vault/router upgrade pattern).
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), ReferralError> {
        storage::require_admin(&env)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    /// L1-18/R-3: the referrer's rolling 14-day volume from the market's
    /// get_trader_volume view. Fail-closed to 0 — an unreadable market
    /// means the volume gate cannot be satisfied (admin may set the floor
    /// to 0 to disable gating instead).
    fn trader_volume_at_market(env: &Env, market: &Address, referrer: &Address) -> i128 {
        let args: Vec<Val> = (referrer.clone(),).into_val(env);
        match env.try_invoke_contract::<i128, soroban_sdk::Error>(
            market,
            &Symbol::new(env, "get_trader_volume"),
            args,
        ) {
            Ok(Ok(volume)) if volume > 0 => volume,
            _ => 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::token::StellarAssetClient;
    use soroban_sdk::{Env, String};

    /// Mock market exposing the L1-18 get_trader_volume view (fixed $5k).
    #[contract]
    pub struct MockMarket;

    #[contractimpl]
    impl MockMarket {
        pub fn get_trader_volume(_env: Env, _trader: Address) -> i128 {
            5_000_0000000
        }
    }

    fn setup_full() -> (Env, Address, Address, soroban_sdk::Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, ReferralContract);
        let admin = Address::generate(&env);
        let market = Address::generate(&env);
        let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let client = ReferralContractClient::new(&env, &id);
        client.initialize(&admin, &market, &usdc);
        // Legacy fixtures predate the R-3 gate (market here is a plain
        // address, so the cross-read fails-closed to 0) — disable the
        // floor; the dedicated gate test re-enables it with MockMarket.
        client.set_min_code_volume(&0);
        (env, admin, market, id, usdc)
    }

    fn setup() -> (Env, Address, Address, soroban_sdk::Address) {
        let (env, admin, market, id, _usdc) = setup_full();
        (env, admin, market, id)
    }

    /// R-1: any initialized-gated call (all hot paths route through
    /// require_initialized) must re-arm the instance rent.
    #[test]
    fn initialized_gate_rearms_instance_ttl() {
        use soroban_sdk::testutils::storage::Instance as _;
        use soroban_sdk::testutils::Ledger as _;
        use noether_common::ttl::{TTL_EXTEND_TO, TTL_THRESHOLD};

        let (env, _admin, _market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);

        env.ledger().with_mut(|li| li.sequence_number += TTL_EXTEND_TO - 1_000);
        let before = env.as_contract(&id, || env.storage().instance().get_ttl());
        assert!(before < TTL_THRESHOLD, "precondition: inside the re-extend window");

        client.get_admin();

        let after = env.as_contract(&id, || env.storage().instance().get_ttl());
        assert_eq!(after, TTL_EXTEND_TO, "gated call must re-arm the instance TTL");
    }

    #[test]
    fn version_returns_marker() {
        let env = Env::default();
        let id = env.register_contract(None, ReferralContract);
        let client = ReferralContractClient::new(&env, &id);
        assert_eq!(client.version(), Symbol::new(&env, "referral_v1"));
    }

    #[test]
    fn initialize_pins_admin_market_and_defaults() {
        // Raw init (no harness overrides) so the TRUE defaults are pinned.
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, ReferralContract);
        let admin = Address::generate(&env);
        let market = Address::generate(&env);
        let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let client = ReferralContractClient::new(&env, &id);
        client.initialize(&admin, &market, &usdc);
        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.get_market(), market);
        let (discount, share, vol) = client.get_config();
        assert_eq!(discount, DEFAULT_DISCOUNT_BPS);
        assert_eq!(share, DEFAULT_REFERRER_SHARE_BPS);
        assert_eq!(vol, DEFAULT_MIN_CODE_VOLUME);
    }

    #[test]
    fn create_code_round_trips() {
        let (env, _admin, _market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);
        let referrer = Address::generate(&env);
        client.create_code(&referrer, &String::from_str(&env, "alice42"));
        let info = client.get_info(&referrer);
        assert_eq!(info.code, String::from_str(&env, "alice42"));
        assert_eq!(info.referred_count, 0);
        assert_eq!(info.claimable, 0);

        let resolved = client.resolve_code(&String::from_str(&env, "alice42"));
        assert_eq!(resolved, Some(referrer));
    }

    #[test]
    fn resolving_a_code_refreshes_its_ttl() {
        use soroban_sdk::testutils::{storage::Persistent as _, Ledger as _};
        // audit #19: reading an identity entry on a live path re-extends its
        // TTL, so a code (and referee link / revocation) can't silently archive
        // out from under an active relationship.
        let (env, _admin, _market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);
        let referrer = Address::generate(&env);
        let code = String::from_str(&env, "alice42");
        client.create_code(&referrer, &code);

        let key = crate::types::StorageKey::Code(code.clone());
        let ttl0 = env.as_contract(&id, || env.storage().persistent().get_ttl(&key));

        // Age the ledger until the entry is near expiry (below the ~1-day
        // re-extend threshold) but not yet archived.
        env.ledger().set_sequence_number(env.ledger().sequence() + ttl0 - 1_000);
        let ttl_low = env.as_contract(&id, || env.storage().persistent().get_ttl(&key));
        assert!(ttl_low < 17_280, "precondition: TTL {} should be below threshold", ttl_low);

        // Resolving the code must re-extend it (pre-fix it stayed at ttl_low
        // and would eventually archive).
        assert_eq!(client.resolve_code(&code), Some(referrer));
        let ttl_after = env.as_contract(&id, || env.storage().persistent().get_ttl(&key));
        assert!(ttl_after > ttl_low, "resolve should refresh TTL: {} -> {}", ttl_low, ttl_after);
    }

    #[test]
    fn security_critical_entry_points_require_auth() {
        // audit #5: clear the mocked auths and assert each require_auth bites at
        // the HOST layer (a try_ OUTER Err). A dropped require_auth would make
        // these `Ok(..)` and fail the assertion.
        let (env, _admin, _market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);
        let referrer = Address::generate(&env);
        let referee = Address::generate(&env);
        let code = String::from_str(&env, "alice42");
        client.create_code(&referrer, &code);

        env.set_auths(&[]);

        // Participant-authed.
        assert!(client
            .try_create_code(&Address::generate(&env), &String::from_str(&env, "bob99"))
            .is_err());
        assert!(client.try_set_referrer(&referee, &code).is_err());
        assert!(client.try_claim(&referrer).is_err());
        // Market-authed (require_market → get_market().require_auth()).
        assert!(client.try_record_trade(&referee, &100i128, &1_000i128).is_err());
        // Admin-authed (require_admin).
        assert!(client.try_revoke_code(&code).is_err());
        assert!(client.try_set_discount_bps(&500u32).is_err());
    }

    #[test]
    fn create_code_rejects_duplicate() {
        let (env, _admin, _market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);
        let r1 = Address::generate(&env);
        let r2 = Address::generate(&env);
        client.create_code(&r1, &String::from_str(&env, "alice42"));
        let res = client.try_create_code(&r2, &String::from_str(&env, "alice42"));
        assert_eq!(res, Err(Ok(ReferralError::CodeAlreadyTaken)));
    }

    #[test]
    fn create_code_rejects_short_or_long() {
        let (env, _admin, _market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);
        let r = Address::generate(&env);
        let short = client.try_create_code(&r, &String::from_str(&env, "ab"));
        assert_eq!(short, Err(Ok(ReferralError::CodeTooShort)));
        let long = client.try_create_code(&r, &String::from_str(&env, &"x".repeat(20)));
        assert_eq!(long, Err(Ok(ReferralError::CodeTooLong)));
    }

    #[test]
    fn create_code_rejects_second_code_per_referrer() {
        let (env, _admin, _market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);
        let r = Address::generate(&env);
        client.create_code(&r, &String::from_str(&env, "alice42"));
        let res = client.try_create_code(&r, &String::from_str(&env, "alice99"));
        assert_eq!(res, Err(Ok(ReferralError::AlreadyHasCode)));
    }

    #[test]
    fn admin_can_tune_bps_and_volume() {
        let (env, _admin, _market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);
        client.set_discount_bps(&200);
        client.set_referrer_share_bps(&500);
        client.set_min_code_volume(&50_0000000);
        let (d, s, v) = client.get_config();
        assert_eq!(d, 200);
        assert_eq!(s, 500);
        assert_eq!(v, 50_0000000);
    }

    #[test]
    fn admin_rejects_bps_above_cap() {
        let (env, _admin, _market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);
        let res = client.try_set_discount_bps(&(MAX_BPS + 1));
        assert_eq!(res, Err(Ok(ReferralError::InvalidParameter)));
    }

    #[test]
    fn set_referrer_binds_and_blocks_double_bind() {
        let (env, _admin, _market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);
        let referrer = Address::generate(&env);
        let referee = Address::generate(&env);
        client.create_code(&referrer, &String::from_str(&env, "alice42"));

        client.set_referrer(&referee, &String::from_str(&env, "alice42"));
        assert_eq!(client.get_referrer(&referee), Some(referrer.clone()));
        let info = client.get_info(&referrer);
        assert_eq!(info.referred_count, 1);

        // Cannot rebind.
        let again = client.try_set_referrer(&referee, &String::from_str(&env, "alice42"));
        assert_eq!(again, Err(Ok(ReferralError::AlreadyHasReferrer)));
    }

    #[test]
    fn set_referrer_rejects_self_referral_and_unknown_code() {
        let (env, _admin, _market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);
        let me = Address::generate(&env);
        client.create_code(&me, &String::from_str(&env, "selfsame"));
        let self_res = client.try_set_referrer(&me, &String::from_str(&env, "selfsame"));
        assert_eq!(self_res, Err(Ok(ReferralError::SelfReferral)));

        let stranger = Address::generate(&env);
        let unknown = client.try_set_referrer(&stranger, &String::from_str(&env, "doesnotexist"));
        assert_eq!(unknown, Err(Ok(ReferralError::UnknownCode)));
    }

    #[test]
    fn record_trade_credits_referrer_and_returns_discount_payout() {
        let (env, _admin, _market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);
        let referrer = Address::generate(&env);
        let referee = Address::generate(&env);
        client.create_code(&referrer, &String::from_str(&env, "alice42"));
        client.set_referrer(&referee, &String::from_str(&env, "alice42"));

        // Original fee = 1000 USDC * 10^7 = 10_000_000_000; volume $200k.
        let (discount, payout) = client.record_trade(&referee, &10_000_000_000, &200_000_0000000);
        // discount = 10_000_000_000 * 400 / 10_000 = 400_000_000
        assert_eq!(discount, 400_000_000);
        // payout = 10_000_000_000 * 1000 / 10_000 = 1_000_000_000
        assert_eq!(payout, 1_000_000_000);

        let info = client.get_info(&referrer);
        assert_eq!(info.total_earned, 1_000_000_000);
        assert_eq!(info.claimable, 1_000_000_000);
        // R-8 fix: the stat is VOLUME generated, not fees generated.
        assert_eq!(info.total_volume_generated, 200_000_0000000);
    }

    #[test]
    fn record_trade_no_op_for_unbound_referee() {
        let (env, _admin, _market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);
        let stranger = Address::generate(&env);
        let (d, p) = client.record_trade(&stranger, &10_000_000_000, &0);
        assert_eq!(d, 0);
        assert_eq!(p, 0);
    }

    fn bind_and_accrue(
        env: &Env,
        client: &ReferralContractClient,
    ) -> (Address, Address) {
        let referrer = Address::generate(env);
        let referee = Address::generate(env);
        client.create_code(&referrer, &String::from_str(env, "alice42"));
        client.set_referrer(&referee, &String::from_str(env, "alice42"));
        client.record_trade(&referee, &10_000_000_000, &100_000_0000000);
        (referrer, referee)
    }

    #[test]
    fn claim_transfers_usdc_and_blocks_re_claim() {
        let (env, _admin, _market, id, usdc) = setup_full();
        let client = ReferralContractClient::new(&env, &id);
        let (referrer, _referee) = bind_and_accrue(&env, &client);

        // Fund the pool the way the market does (push-style pot transfer).
        StellarAssetClient::new(&env, &usdc).mint(&id, &1_000_000_000);
        let usdc_client = token::Client::new(&env, &usdc);
        assert_eq!(usdc_client.balance(&referrer), 0);

        let claimed = client.claim(&referrer);
        assert_eq!(claimed, 1_000_000_000);
        assert_eq!(usdc_client.balance(&referrer), 1_000_000_000);
        assert_eq!(usdc_client.balance(&id), 0);
        let info = client.get_info(&referrer);
        assert_eq!(info.claimable, 0);
        assert_eq!(info.total_earned, 1_000_000_000); // lifetime preserved

        let again = client.try_claim(&referrer);
        assert_eq!(again, Err(Ok(ReferralError::NothingToClaim)));
    }

    #[test]
    fn claim_unfunded_preserves_claimable() {
        let (env, _admin, _market, id, usdc) = setup_full();
        let client = ReferralContractClient::new(&env, &id);
        let (referrer, _referee) = bind_and_accrue(&env, &client);

        // No funding: claim must reject WITHOUT burning the balance.
        let res = client.try_claim(&referrer);
        assert_eq!(res, Err(Ok(ReferralError::ClaimUnfunded)));
        assert_eq!(client.get_info(&referrer).claimable, 1_000_000_000);

        // Partially funded is still unfunded for the full amount.
        StellarAssetClient::new(&env, &usdc).mint(&id, &400_000_000);
        let res = client.try_claim(&referrer);
        assert_eq!(res, Err(Ok(ReferralError::ClaimUnfunded)));
        assert_eq!(client.get_info(&referrer).claimable, 1_000_000_000);
    }

    #[test]
    fn min_code_volume_gate_cross_reads_market() {
        let (env, _admin, _market, id, _usdc) = setup_full();
        let client = ReferralContractClient::new(&env, &id);
        // Point at a mock market whose view reports $5k rolling volume.
        let mock_market = env.register_contract(None, MockMarket);
        client.set_market(&mock_market);

        let referrer = Address::generate(&env);
        client.set_min_code_volume(&10_000_0000000);
        let res = client.try_create_code(&referrer, &String::from_str(&env, "whale01"));
        assert_eq!(res, Err(Ok(ReferralError::InsufficientVolume)));

        client.set_min_code_volume(&5_000_0000000);
        client.create_code(&referrer, &String::from_str(&env, "whale01"));
        assert!(client.resolve_code(&String::from_str(&env, "whale01")).is_some());
    }

    #[test]
    fn revoked_referrer_accrues_nothing_and_code_stops_binding() {
        let (env, _admin, _market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);
        let (referrer, referee) = bind_and_accrue(&env, &client);
        let before = client.get_info(&referrer).claimable;

        client.revoke_code(&String::from_str(&env, "alice42"));
        let (d, p) = client.record_trade(&referee, &10_000_000_000, &100_000_0000000);
        assert_eq!((d, p), (0, 0));
        assert_eq!(client.get_info(&referrer).claimable, before);

        let newbie = Address::generate(&env);
        let bind = client.try_set_referrer(&newbie, &String::from_str(&env, "alice42"));
        assert_eq!(bind, Err(Ok(ReferralError::RevokedCode)));

        // Reversible: unrevoke restores accrual.
        client.unrevoke_code(&String::from_str(&env, "alice42"));
        let (d2, _p2) = client.record_trade(&referee, &10_000_000_000, &0);
        assert_eq!(d2, 400_000_000);
    }

    #[test]
    fn paused_registry_is_noop_and_blocks_state_changes() {
        let (env, _admin, _market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);
        let (referrer, referee) = bind_and_accrue(&env, &client);
        let before = client.get_info(&referrer).claimable;

        client.set_paused(&true);
        let (d, p) = client.record_trade(&referee, &10_000_000_000, &0);
        assert_eq!((d, p), (0, 0));
        assert_eq!(client.get_info(&referrer).claimable, before);
        let newcode = client.try_create_code(&Address::generate(&env), &String::from_str(&env, "latecomer"));
        assert_eq!(newcode, Err(Ok(ReferralError::RegistryPaused)));

        client.set_paused(&false);
        let (d2, _p2) = client.record_trade(&referee, &10_000_000_000, &0);
        assert_eq!(d2, 400_000_000);
    }

    #[test]
    fn unbind_stops_accrual() {
        let (env, _admin, _market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);
        let (referrer, referee) = bind_and_accrue(&env, &client);
        let before = client.get_info(&referrer).claimable;

        client.unbind(&referee);
        assert_eq!(client.get_referrer(&referee), None);
        let (d, p) = client.record_trade(&referee, &10_000_000_000, &0);
        assert_eq!((d, p), (0, 0));
        assert_eq!(client.get_info(&referrer).claimable, before);
    }

    #[test]
    fn set_market_repoints() {
        let (env, _admin, market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);
        assert_eq!(client.get_market(), market);
        let new_market = Address::generate(&env);
        client.set_market(&new_market);
        assert_eq!(client.get_market(), new_market);
    }
}
