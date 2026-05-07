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

use soroban_sdk::{contract, contractimpl, Env, Symbol};

#[contract]
pub struct ReferralContract;

#[contractimpl]
impl ReferralContract {
    pub fn version(env: Env) -> Symbol {
        Symbol::new(&env, "referral_v0")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn version_returns_marker() {
        let env = Env::default();
        let id = env.register_contract(None, ReferralContract);
        let client = ReferralContractClient::new(&env, &id);
        assert_eq!(client.version(), Symbol::new(&env, "referral_v0"));
    }
}
