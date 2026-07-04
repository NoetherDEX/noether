//! # Risk contract (Tranche 3)
//!
//! Per-market `RiskConfig` registry + the WASM-heavy risk computations
//! (partial-liquidation sizing, ADL candidate ranking) that deliberately
//! live OUTSIDE the market contract — the market is at its 64KB WASM
//! budget, and the audit's Phase-5 plan says these loops belong in a
//! dedicated risk/router contract (TASKS.md P5-1, P5-5, P5-7, P5-10).
//!
//! It is a pure policy/compute layer: it stores config and derives numbers
//! the keeper acts on. It holds no funds and moves no positions — the
//! keeper submits the resulting partial-liquidation / ADL closes to the
//! market, which re-verifies on-chain (the JELLY/GMX lesson: never trust a
//! keeper-supplied ranking without on-chain recheck).

#![no_std]

mod risk;
use risk::{adl_rank, partial_liq_tranche, RiskConfig};
use noether_common::ttl::{TTL_EXTEND_TO, TTL_THRESHOLD};
use noether_common::NoetherError;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Vec};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Initialized,
    /// RiskConfig per asset symbol.
    Config(Symbol),
}

/// One ADL candidate the keeper hands in; the contract ranks + re-checks.
#[contracttype]
#[derive(Clone)]
pub struct AdlCandidate {
    pub position_id: u64,
    pub pnl: i128,
    pub collateral: i128,
    pub leverage: u32,
}

/// A candidate scored + ordered for ADL (highest priority first).
#[contracttype]
#[derive(Clone)]
pub struct RankedAdl {
    pub position_id: u64,
    pub rank: i128,
}

#[contract]
pub struct RiskContract;

#[contractimpl]
impl RiskContract {
    /// One-time setup, pins the admin who can set per-market configs.
    pub fn initialize(env: Env, admin: Address) -> Result<(), NoetherError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(NoetherError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(())
    }

    /// Store (or replace) the risk parameters for one market. Admin-only.
    /// Enforces the MM = IM/2 invariant (P5-2) via `RiskConfig::is_valid`.
    pub fn set_config(env: Env, asset: Symbol, config: RiskConfig) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        if !config.is_valid() {
            return Err(NoetherError::InvalidParameter);
        }
        let key = DataKey::Config(asset);
        env.storage().persistent().set(&key, &config);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(())
    }

    /// Fetch a market's risk config. Errors if unset (a pair with no config
    /// must not trade — fail closed).
    pub fn get_config(env: Env, asset: Symbol) -> Result<RiskConfig, NoetherError> {
        env.storage()
            .persistent()
            .get(&DataKey::Config(asset))
            .ok_or(NoetherError::NotInitialized)
    }

    /// Maintenance-margin bps for a market (keeper liquidation-health calc).
    pub fn maintenance_margin_bps(env: Env, asset: Symbol) -> Result<u32, NoetherError> {
        Ok(Self::get_config(env, asset)?.mm_bps)
    }

    /// Partial-liquidation tranche size for a position in this market
    /// (P5-5): `tranche_bps` of the size, floored at `min_notional`, capped
    /// at the whole position. Below `full_close` notional the keeper should
    /// full-close instead (policy decided by the caller from the health gap).
    pub fn partial_liq_amount(
        env: Env,
        asset: Symbol,
        position_size: i128,
        tranche_bps: u32,
        min_notional: i128,
    ) -> Result<i128, NoetherError> {
        // Config presence is the market's trade gate; require it here too.
        let _ = Self::get_config(env, asset)?;
        Ok(partial_liq_tranche(position_size, tranche_bps, min_notional))
    }

    /// Rank ADL candidates by PnL% × leverage, highest first (P5-7). The
    /// keeper supplies candidates; the market re-verifies each close. Only
    /// profitable positions (rank > 0) are returned.
    pub fn rank_adl(env: Env, candidates: Vec<AdlCandidate>) -> Vec<RankedAdl> {
        let mut ranked: Vec<RankedAdl> = Vec::new(&env);
        for c in candidates.iter() {
            let r = adl_rank(c.pnl, c.collateral, c.leverage);
            if r > 0 {
                ranked.push_back(RankedAdl {
                    position_id: c.position_id,
                    rank: r,
                });
            }
        }
        // Insertion sort by rank descending (candidate lists are small —
        // the keeper only supplies positions above the trigger threshold).
        let n = ranked.len();
        let mut i = 1u32;
        while i < n {
            let cur = ranked.get(i).unwrap();
            let mut j = i;
            while j > 0 && ranked.get(j - 1).unwrap().rank < cur.rank {
                let prev = ranked.get(j - 1).unwrap();
                ranked.set(j, prev);
                j -= 1;
            }
            ranked.set(j, cur);
            i += 1;
        }
        ranked
    }

    /// Rotate the admin. Both old and new admins must sign.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        new_admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    pub fn get_admin(env: Env) -> Result<Address, NoetherError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(NoetherError::NotInitialized)
    }

    /// Swap the running WASM in place (admin-gated), preserving all config.
    pub fn upgrade(env: Env, new_wasm_hash: soroban_sdk::BytesN<32>) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    fn require_admin(env: &Env) -> Result<(), NoetherError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(NoetherError::NotInitialized)?;
        admin.require_auth();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup() -> (Env, Address, RiskContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let id = env.register_contract(None, RiskContract);
        let client = RiskContractClient::new(&env, &id);
        client.initialize(&admin);
        (env, admin, client)
    }

    #[test]
    fn stores_and_reads_config() {
        let (env, _admin, client) = setup();
        let btc = Symbol::new(&env, "BTC");
        client.set_config(&btc, &RiskConfig::major(2_500));
        let got = client.get_config(&btc);
        assert_eq!(got.mm_bps, 200);
        assert_eq!(client.maintenance_margin_bps(&btc), 200);
    }

    #[test]
    fn initialize_is_one_shot() {
        let (_env, admin, client) = setup();
        let res = client.try_initialize(&admin);
        assert_eq!(res, Err(Ok(NoetherError::AlreadyInitialized)));
    }

    #[test]
    fn rejects_invalid_config() {
        let (env, _admin, client) = setup();
        let btc = Symbol::new(&env, "BTC");
        let mut bad = RiskConfig::major(2_500);
        bad.mm_bps = bad.im_bps; // violates MM = IM/2
        let res = client.try_set_config(&btc, &bad);
        assert_eq!(res, Err(Ok(NoetherError::InvalidParameter)));
    }

    #[test]
    fn unset_market_fails_closed() {
        let (env, _admin, client) = setup();
        let res = client.try_get_config(&Symbol::new(&env, "DOGE"));
        assert_eq!(res, Err(Ok(NoetherError::NotInitialized)));
    }

    #[test]
    fn partial_liq_amount_uses_tranche_math() {
        let (env, _admin, client) = setup();
        let btc = Symbol::new(&env, "BTC");
        client.set_config(&btc, &RiskConfig::major(2_500));
        // 20% of 1000 = 200
        assert_eq!(client.partial_liq_amount(&btc, &1_000, &2_000, &50), 200);
    }

    #[test]
    fn rank_adl_orders_desc_and_drops_losers() {
        let (env, _admin, client) = setup();
        let candidates = soroban_sdk::vec![
            &env,
            AdlCandidate { position_id: 1, pnl: 50, collateral: 100, leverage: 5 },
            AdlCandidate { position_id: 2, pnl: 50, collateral: 100, leverage: 10 },
            AdlCandidate { position_id: 3, pnl: -10, collateral: 100, leverage: 10 },
        ];
        let ranked = client.rank_adl(&candidates);
        // Position 3 (losing) dropped; 2 (higher leverage) ranks before 1.
        assert_eq!(ranked.len(), 2);
        assert_eq!(ranked.get(0).unwrap().position_id, 2);
        assert_eq!(ranked.get(1).unwrap().position_id, 1);
    }

    #[test]
    fn admin_only_set_config() {
        let (env, _admin, client) = setup();
        env.set_auths(&[]);
        let res = client.try_set_config(&Symbol::new(&env, "BTC"), &RiskConfig::major(2_500));
        assert!(res.is_err());
    }
}
