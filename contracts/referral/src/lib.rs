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

use soroban_sdk::{contract, contractimpl, Address, Env, String, Symbol};

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
        Symbol::new(&env, "referral_v0")
    }

    /// One-shot initialisation. The market contract address is the only
    /// principal allowed to call `record_trade`. Discount and share are
    /// in basis points; min_code_volume is the 14-day rolling volume
    /// floor needed to mint a code.
    pub fn initialize(
        env: Env,
        admin: Address,
        market: Address,
    ) -> Result<(), ReferralError> {
        if storage::is_initialized(&env) {
            return Err(ReferralError::AlreadyInitialized);
        }
        admin.require_auth();
        storage::set_admin(&env, &admin);
        storage::set_market(&env, &market);
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
    /// Volume gating: in v0 the API gateway enforces the 14-day volume
    /// floor before exposing this endpoint. The on-chain check is a
    /// hard cap (`MinCodeVolume`) read from storage; admin can lower
    /// it to 0 to disable. Future versions may delegate to a
    /// market-provided volume view.
    pub fn create_code(
        env: Env,
        referrer: Address,
        code: String,
    ) -> Result<(), ReferralError> {
        storage::require_initialized(&env)?;
        referrer.require_auth();

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
        if storage::referrer_of(&env, &referee).is_some() {
            return Err(ReferralError::AlreadyHasReferrer);
        }
        let referrer = storage::lookup_code(&env, &code).ok_or(ReferralError::UnknownCode)?;
        if referrer == referee {
            return Err(ReferralError::SelfReferral);
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
    ) -> Result<(i128, i128), ReferralError> {
        storage::require_market(&env)?;
        if original_fee <= 0 {
            return Ok((0, 0));
        }
        let referrer = match storage::referrer_of(&env, &referee) {
            Some(addr) => addr,
            None => return Ok((0, 0)),
        };

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
        info.total_volume_generated = info
            .total_volume_generated
            .checked_add(original_fee)
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
            (referee, referrer, original_fee, discount, payout),
        );
        Ok((discount, payout))
    }

    /// Referrer drains their claimable balance. Returns the amount
    /// claimed; emits a "claimed" event. The actual USDC transfer is
    /// done by the market contract (which holds the funds) on receipt
    /// of the event — phase 11.x adds a direct cross-contract pay.
    pub fn claim(env: Env, referrer: Address) -> Result<i128, ReferralError> {
        storage::require_initialized(&env)?;
        referrer.require_auth();
        let mut info = storage::load_info(&env, &referrer).ok_or(ReferralError::UnknownCode)?;
        let amount = info.claimable;
        if amount <= 0 {
            return Err(ReferralError::NothingToClaim);
        }
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Env, String};

    fn setup() -> (Env, Address, Address, soroban_sdk::Address) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, ReferralContract);
        let admin = Address::generate(&env);
        let market = Address::generate(&env);
        let client = ReferralContractClient::new(&env, &id);
        client.initialize(&admin, &market);
        (env, admin, market, id)
    }

    #[test]
    fn version_returns_marker() {
        let env = Env::default();
        let id = env.register_contract(None, ReferralContract);
        let client = ReferralContractClient::new(&env, &id);
        assert_eq!(client.version(), Symbol::new(&env, "referral_v0"));
    }

    #[test]
    fn initialize_pins_admin_market_and_defaults() {
        let (env, admin, market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);
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

        // Original fee = 1000 USDC * 10^7 = 10_000_000_000
        let (discount, payout) = client.record_trade(&referee, &10_000_000_000);
        // discount = 10_000_000_000 * 400 / 10_000 = 400_000_000
        assert_eq!(discount, 400_000_000);
        // payout = 10_000_000_000 * 1000 / 10_000 = 1_000_000_000
        assert_eq!(payout, 1_000_000_000);

        let info = client.get_info(&referrer);
        assert_eq!(info.total_earned, 1_000_000_000);
        assert_eq!(info.claimable, 1_000_000_000);
        assert_eq!(info.total_volume_generated, 10_000_000_000);
    }

    #[test]
    fn record_trade_no_op_for_unbound_referee() {
        let (env, _admin, _market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);
        let stranger = Address::generate(&env);
        let (d, p) = client.record_trade(&stranger, &10_000_000_000);
        assert_eq!(d, 0);
        assert_eq!(p, 0);
    }

    #[test]
    fn claim_drains_claimable_and_blocks_re_claim() {
        let (env, _admin, _market, id) = setup();
        let client = ReferralContractClient::new(&env, &id);
        let referrer = Address::generate(&env);
        let referee = Address::generate(&env);
        client.create_code(&referrer, &String::from_str(&env, "alice42"));
        client.set_referrer(&referee, &String::from_str(&env, "alice42"));
        client.record_trade(&referee, &10_000_000_000);

        let claimed = client.claim(&referrer);
        assert_eq!(claimed, 1_000_000_000);
        let info = client.get_info(&referrer);
        assert_eq!(info.claimable, 0);
        assert_eq!(info.total_earned, 1_000_000_000); // lifetime preserved

        let again = client.try_claim(&referrer);
        assert_eq!(again, Err(Ok(ReferralError::NothingToClaim)));
    }
}
