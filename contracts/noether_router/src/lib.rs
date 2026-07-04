//! # Noether Router — atomic verify-then-trade
//!
//! Soroban permits exactly one host-function operation per transaction, so a
//! consumer cannot "prepend" a Noeracle price-update op to its own
//! `open_position` op (the two-operation Pattern A in Noeracle's docs can't be
//! submitted on Stellar). This router collapses both into ONE invocation: it
//! relays a freshly-signed Noeracle price into the oracle's persistent storage,
//! then immediately calls the (untouched) market in the same transaction.
//!
//! Because the market reads price through `oracle_adapter → noeracle_shim →
//! get_price_pers`, it sees the price this router just stored — sub-second
//! fresh at execution time, so it can never trip the market's staleness check
//! (`#30 PriceStale`). The market contract is not modified or redeployed.
//!
//! ## Auth
//!
//! The trader is the transaction source account and authorises the whole call
//! tree (router → market.open_position → USDC transfer) with their normal
//! signature. Unlike `vault_factory` — where the vault's own funds move and the
//! contract must `authorize_as_current_contract` — this router moves none of
//! its own funds, so it needs no auth gymnastics. It is a transparent
//! pass-through; the market remains the real authorisation gate.
//!
//! ## Security (testnet)
//!
//! The persistent slot is written via Noeracle `update_ed25519_persistent`,
//! which in `oracle_v0` does NOT enforce registered-publisher / staleness /
//! monotonic-round checks (see `docs/noeracle-feature-requests.md`, S-1). On
//! testnet (valueless tokens) this is acceptable. Before mainnet, Noeracle must
//! harden that path, or this router inherits the "anyone can set the price"
//! weakness.

#![no_std]
// Soroban entry points carrying full oracle attestations exceed clippy's 7-arg heuristic
#![allow(clippy::too_many_arguments)]

use noether_common::{assets::symbol_to_tag, ttl::{TTL_EXTEND_TO, TTL_THRESHOLD}, Direction, NoetherError, Position};
use soroban_sdk::{
    contract, contractimpl, contracttype, Address, BytesN, Env, IntoVal, Symbol, Val, Vec,
};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Market,
    Noeracle,
    Initialized,
    /// Publisher pubkeys whose attestations refresh_price will relay
    Publishers,
}

/// One signed Noeracle price attestation (used by the multi-asset
/// cross-liquidation entry point).
#[contracttype]
#[derive(Clone)]
pub struct PriceAttestation {
    pub asset: Symbol,
    pub price: i128,
    pub timestamp: u64,
    pub round_id: u64,
    pub pubkeys: Vec<BytesN<32>>,
    pub sigs: Vec<BytesN<64>>,
}

#[contract]
pub struct NoetherRouterContract;

#[contractimpl]
impl NoetherRouterContract {
    /// One-time setup. Records the admin (who can rotate the market /
    /// Noeracle addresses), the market and Noeracle contract addresses,
    /// and the allowed publisher keys — refresh_price relays ONLY
    /// attestations signed by these (O-2: without the allowlist any
    /// trader could self-sign a price and trade against it).
    pub fn initialize(
        env: Env,
        admin: Address,
        market: Address,
        noeracle: Address,
        publishers: Vec<BytesN<32>>,
    ) -> Result<(), NoetherError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(NoetherError::AlreadyInitialized);
        }
        if publishers.is_empty() {
            return Err(NoetherError::InvalidParameter);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Market, &market);
        env.storage().instance().set(&DataKey::Noeracle, &noeracle);
        env.storage().instance().set(&DataKey::Publishers, &publishers);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(())
    }

    /// Verify a freshly-signed Noeracle price, store it, then open a position
    /// against it — atomically, in one transaction.
    ///
    /// `asset` is the market asset symbol (e.g. "BTC"); the 8-byte Noeracle tag
    /// is derived from it, so it must equal the tag the publisher signed (the
    /// canonical `<SYM>USD` form) or the oracle's signature check fails and the
    /// whole transaction reverts. `price` / `timestamp` / `round_id` /
    /// `pubkeys` / `sigs` are the raw fields of one Noeracle attestation.
    pub fn open_with_price(
        env: Env,
        trader: Address,
        asset: Symbol,
        collateral: i128,
        leverage: u32,
        direction: Direction,
        price: i128,
        timestamp: u64,
        round_id: u64,
        pubkeys: Vec<BytesN<32>>,
        sigs: Vec<BytesN<64>>,
    ) -> Result<Position, NoetherError> {
        Self::require_initialized(&env)?;
        trader.require_auth();

        Self::refresh_price(&env, &asset, price, timestamp, round_id, pubkeys, sigs)?;

        let market = Self::market_addr(&env)?;
        let open_args: Vec<Val> = (trader, asset, collateral, leverage, direction).into_val(&env);
        let position: Position =
            env.invoke_contract(&market, &Symbol::new(&env, "open_position"), open_args);
        Ok(position)
    }

    /// Verify a freshly-signed Noeracle price for the position's asset, store
    /// it, then close the position against it — atomically. `asset` MUST be the
    /// position's asset (the market reads that asset's oracle price on close).
    /// Returns realised PnL.
    pub fn close_with_price(
        env: Env,
        trader: Address,
        position_id: u64,
        asset: Symbol,
        price: i128,
        timestamp: u64,
        round_id: u64,
        pubkeys: Vec<BytesN<32>>,
        sigs: Vec<BytesN<64>>,
    ) -> Result<i128, NoetherError> {
        Self::require_initialized(&env)?;
        trader.require_auth();

        Self::refresh_price(&env, &asset, price, timestamp, round_id, pubkeys, sigs)?;

        let market = Self::market_addr(&env)?;
        let close_args: Vec<Val> = (trader, position_id).into_val(&env);
        let pnl: i128 =
            env.invoke_contract(&market, &Symbol::new(&env, "close_position"), close_args);
        Ok(pnl)
    }

    /// Verify + store a fresh price, then liquidate the position against
    /// it — liquidations no longer depend on the heartbeat staying inside
    /// the market's 60s staleness window (O-3/K-3). Returns the keeper
    /// reward.
    pub fn liquidate_with_price(
        env: Env,
        keeper: Address,
        position_id: u64,
        asset: Symbol,
        price: i128,
        timestamp: u64,
        round_id: u64,
        pubkeys: Vec<BytesN<32>>,
        sigs: Vec<BytesN<64>>,
    ) -> Result<i128, NoetherError> {
        Self::require_initialized(&env)?;
        keeper.require_auth();

        Self::refresh_price(&env, &asset, price, timestamp, round_id, pubkeys, sigs)?;

        let market = Self::market_addr(&env)?;
        let args: Vec<Val> = (keeper, position_id).into_val(&env);
        let reward: i128 = env.invoke_contract(&market, &Symbol::new(&env, "liquidate"), args);
        Ok(reward)
    }

    /// Verify + store a fresh price, then execute the pending order
    /// against it. `asset` MUST be the order's asset. Returns the keeper
    /// fee (0 = order cancelled rather than executed).
    pub fn execute_with_price(
        env: Env,
        keeper: Address,
        order_id: u64,
        asset: Symbol,
        price: i128,
        timestamp: u64,
        round_id: u64,
        pubkeys: Vec<BytesN<32>>,
        sigs: Vec<BytesN<64>>,
    ) -> Result<i128, NoetherError> {
        Self::require_initialized(&env)?;
        keeper.require_auth();

        Self::refresh_price(&env, &asset, price, timestamp, round_id, pubkeys, sigs)?;

        let market = Self::market_addr(&env)?;
        let args: Vec<Val> = (keeper, order_id).into_val(&env);
        let fee: i128 = env.invoke_contract(&market, &Symbol::new(&env, "execute_order"), args);
        Ok(fee)
    }

    /// Refresh EVERY asset the trader holds (one attestation each), then
    /// liquidate the whole cross-margin account — the account-level
    /// equity check reads all of them. Returns the keeper reward.
    pub fn liquidate_cross_with_prices(
        env: Env,
        keeper: Address,
        trader: Address,
        attestations: Vec<PriceAttestation>,
    ) -> Result<i128, NoetherError> {
        Self::require_initialized(&env)?;
        keeper.require_auth();

        for att in attestations.iter() {
            Self::refresh_price(
                &env, &att.asset, att.price, att.timestamp, att.round_id,
                att.pubkeys.clone(), att.sigs.clone(),
            )?;
        }

        let market = Self::market_addr(&env)?;
        let args: Vec<Val> = (keeper, trader).into_val(&env);
        let reward: i128 =
            env.invoke_contract(&market, &Symbol::new(&env, "liquidate_cross_account"), args);
        Ok(reward)
    }

    // ───────────────────────────────────────────────────────────────────────
    // Admin
    // ───────────────────────────────────────────────────────────────────────

    /// Replace the allowed publisher key set. Admin-authenticated.
    pub fn set_publishers(
        env: Env,
        publishers: Vec<BytesN<32>>,
    ) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        if publishers.is_empty() {
            return Err(NoetherError::InvalidParameter);
        }
        env.storage().instance().set(&DataKey::Publishers, &publishers);
        Ok(())
    }

    /// Point the router at a different market deployment. Admin-authenticated.
    pub fn set_market(env: Env, new_market: Address) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::Market, &new_market);
        Ok(())
    }

    /// Point the router at a different Noeracle deployment. Admin-authenticated.
    pub fn set_noeracle(env: Env, new_noeracle: Address) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::Noeracle, &new_noeracle);
        Ok(())
    }

    /// Swap the running WASM in place (admin-gated).
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    /// Rotate the admin. Both old and new admins must sign.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        new_admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    // ───────────────────────────────────────────────────────────────────────
    // Views
    // ───────────────────────────────────────────────────────────────────────

    pub fn get_admin(env: Env) -> Result<Address, NoetherError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(NoetherError::NotInitialized)
    }

    pub fn get_market(env: Env) -> Result<Address, NoetherError> {
        Self::market_addr(&env)
    }

    pub fn get_noeracle(env: Env) -> Result<Address, NoetherError> {
        Self::noeracle_addr(&env)
    }

    // ───────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ───────────────────────────────────────────────────────────────────────

    /// Relay one signed attestation into Noeracle's persistent storage. The
    /// 8-byte tag is derived from `asset` so it always matches the slot the
    /// `noeracle_shim` will read on the market's behalf. If the derived tag
    /// doesn't match the signed message, Noeracle's signature check fails and
    /// the whole transaction reverts (a safe failure).
    fn refresh_price(
        env: &Env,
        asset: &Symbol,
        price: i128,
        timestamp: u64,
        round_id: u64,
        pubkeys: Vec<BytesN<32>>,
        sigs: Vec<BytesN<64>>,
    ) -> Result<(), NoetherError> {
        // Publisher allowlist (O-2): every supplied key must be
        // registered, and at least one must be present — the router
        // never relays a self-signed price. Defense-in-depth: O-1
        // hardening in Noeracle itself remains the primary gate.
        let allowed: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&DataKey::Publishers)
            .ok_or(NoetherError::NotInitialized)?;
        if pubkeys.is_empty() {
            return Err(NoetherError::Unauthorized);
        }
        for pk in pubkeys.iter() {
            if !allowed.contains(&pk) {
                return Err(NoetherError::Unauthorized);
            }
        }

        // Coarse sanity bounds (O-7 backstop): a price outside these is
        // garbage regardless of signatures
        let (lo, hi) = price_bounds(env, asset)?;
        if price < lo || price > hi {
            return Err(NoetherError::InvalidPrice);
        }

        let noeracle = Self::noeracle_addr(env)?;
        let tag = symbol_to_tag(env, asset)?;
        let update_args: Vec<Val> =
            (tag, price, timestamp, round_id, pubkeys, sigs).into_val(env);
        env.invoke_contract::<()>(
            &noeracle,
            &Symbol::new(env, "update_ed25519_persistent"),
            update_args,
        );
        Ok(())
    }

    fn market_addr(env: &Env) -> Result<Address, NoetherError> {
        env.storage()
            .instance()
            .get(&DataKey::Market)
            .ok_or(NoetherError::NotInitialized)
    }

    fn noeracle_addr(env: &Env) -> Result<Address, NoetherError> {
        env.storage()
            .instance()
            .get(&DataKey::Noeracle)
            .ok_or(NoetherError::NotInitialized)
    }

    fn require_initialized(env: &Env) -> Result<(), NoetherError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(NoetherError::NotInitialized);
        }
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


// Coarse per-asset sanity bands, 7-decimal fixed point. Deliberately
// wide — they only reject obvious garbage, never legitimate volatility.
fn price_bounds(env: &Env, asset: &Symbol) -> Result<(i128, i128), NoetherError> {
    const P: i128 = 10_000_000;
    // Coarse sanity bands in 7-dec USD: wide enough to never bind in a real
    // market, tight enough to reject a wildly wrong attestation. Must cover
    // every symbol in noether_common::assets::PAIR_TAGS.
    const BANDS: &[(&str, i128, i128)] = &[
        ("BTC", 1_000 * P, 1_000_000 * P),
        ("ETH", 50 * P, 100_000 * P),
        ("XLM", P / 100, 100 * P),
        ("SOL", P, 100_000 * P),
        ("XRP", P / 100, 1_000 * P),
        ("ADA", P / 100, 1_000 * P),
        ("BNB", 10 * P, 100_000 * P),
        ("TRX", P / 100, 1_000 * P),
        ("HYPE", P / 10, 100_000 * P),
        ("DOGE", P / 1_000, 100 * P),
        ("ZEC", P, 100_000 * P),
        ("LINK", P / 10, 10_000 * P),
        ("BCH", P, 100_000 * P),
        ("LTC", P, 100_000 * P),
    ];
    for (sym, lo, hi) in BANDS {
        if asset == &Symbol::new(env, sym) {
            return Ok((*lo, *hi));
        }
    }
    Err(NoetherError::InvalidPrice)
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use noether_common::PRECISION;
    use soroban_sdk::testutils::Address as _;

    // Mock Noeracle: records the price + tag it was asked to store so tests can
    // assert the router relayed the right values. Accepts any signature (real
    // verification is the live contract's job; we test the router's plumbing).
    mod mock_noeracle {
        use soroban_sdk::{contract, contractimpl, symbol_short, BytesN, Env, Vec};

        #[contract]
        pub struct MockNoeracle;

        #[contractimpl]
        impl MockNoeracle {
            pub fn update_ed25519_persistent(
                env: Env,
                asset: BytesN<8>,
                price: i128,
                timestamp: u64,
                round_id: u64,
                pubkeys: Vec<BytesN<32>>,
                sigs: Vec<BytesN<64>>,
            ) {
                env.storage().instance().set(&symbol_short!("PRICE"), &price);
                env.storage().instance().set(&symbol_short!("TAG"), &asset);
                // per-tag map for multi-asset tests
                env.storage().instance().set(&asset, &price);
                let _ = (timestamp, round_id, pubkeys, sigs);
            }

            pub fn recorded_price(env: Env) -> i128 {
                env.storage().instance().get(&symbol_short!("PRICE")).unwrap_or(0)
            }

            pub fn recorded_tag(env: Env) -> BytesN<8> {
                env.storage().instance().get(&symbol_short!("TAG")).unwrap()
            }

            pub fn price_for(env: Env, tag: BytesN<8>) -> i128 {
                env.storage().instance().get(&tag).unwrap_or(0)
            }
        }
    }

    // Mock Market: returns a recognisable Position / PnL so tests can confirm
    // the router forwarded the trade args and returned the market's result.
    mod mock_market {
        use noether_common::{Direction, Position};
        use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};

        #[contract]
        pub struct MockMarket;

        #[contractimpl]
        impl MockMarket {
            pub fn open_position(
                _env: Env,
                trader: Address,
                asset: Symbol,
                collateral: i128,
                leverage: u32,
                direction: Direction,
            ) -> Position {
                Position {
                    id: 777,
                    trader,
                    asset,
                    collateral,
                    size: collateral * (leverage as i128),
                    entry_price: 700_000_000_000_000,
                    direction,
                    leverage,
                    liquidation_price: 0,
                    timestamp: 0,
                    entry_cumulative_funding: 0,
                    margin_mode: 0,
                }
            }

            pub fn close_position(_env: Env, _trader: Address, _position_id: u64) -> i128 {
                4_321
            }

            pub fn liquidate(_env: Env, _keeper: Address, _position_id: u64) -> i128 {
                55
            }

            pub fn execute_order(_env: Env, _keeper: Address, _order_id: u64) -> i128 {
                66
            }

            pub fn liquidate_cross_account(_env: Env, _keeper: Address, _trader: Address) -> i128 {
                77
            }
        }
    }

    fn pubkeys(env: &Env) -> Vec<BytesN<32>> {
        soroban_sdk::vec![env, BytesN::from_array(env, &[7u8; 32])]
    }

    fn sigs(env: &Env) -> Vec<BytesN<64>> {
        soroban_sdk::vec![env, BytesN::from_array(env, &[9u8; 64])]
    }

    struct Fixture {
        env: Env,
        admin: Address,
        market_id: Address,
        noeracle_id: Address,
        client: NoetherRouterContractClient<'static>,
    }

    fn setup() -> Fixture {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let noeracle_id = env.register_contract(None, mock_noeracle::MockNoeracle);
        let market_id = env.register_contract(None, mock_market::MockMarket);
        let router_id = env.register_contract(None, NoetherRouterContract);
        let client = NoetherRouterContractClient::new(&env, &router_id);
        client.initialize(&admin, &market_id, &noeracle_id, &pubkeys(&env));
        Fixture { env, admin, market_id, noeracle_id, client }
    }

    #[test]
    fn initialize_records_addresses() {
        let f = setup();
        assert_eq!(f.client.get_admin(), f.admin);
        assert_eq!(f.client.get_market(), f.market_id);
        assert_eq!(f.client.get_noeracle(), f.noeracle_id);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")] // AlreadyInitialized
    fn initialize_twice_errors() {
        let f = setup();
        f.client.initialize(&f.admin, &f.market_id, &f.noeracle_id, &pubkeys(&f.env));
    }

    #[test]
    fn open_with_price_stores_then_opens() {
        let f = setup();
        let price = 70_000 * PRECISION;
        let pos = f.client.open_with_price(
            &Address::generate(&f.env),
            &Symbol::new(&f.env, "BTC"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
            &price,
            &1_700_000_000u64,
            &42u64,
            &pubkeys(&f.env),
            &sigs(&f.env),
        );

        // Market result is forwarded through unchanged.
        assert_eq!(pos.id, 777);
        assert_eq!(pos.collateral, 100 * PRECISION);
        assert_eq!(pos.leverage, 5);
        assert_eq!(pos.direction, Direction::Long);

        // The router relayed the price and derived the canonical BTC tag.
        let noeracle = mock_noeracle::MockNoeracleClient::new(&f.env, &f.noeracle_id);
        assert_eq!(noeracle.recorded_price(), price);
        assert_eq!(
            noeracle.recorded_tag(),
            BytesN::from_array(&f.env, &[b'B', b'T', b'C', b'U', b'S', b'D', 0, 0])
        );
    }

    #[test]
    fn close_with_price_stores_then_closes() {
        let f = setup();
        let price = 350_000_000_000i128;
        let pnl = f.client.close_with_price(
            &Address::generate(&f.env),
            &99u64,
            &Symbol::new(&f.env, "ETH"),
            &price,
            &1_700_000_000u64,
            &7u64,
            &pubkeys(&f.env),
            &sigs(&f.env),
        );

        assert_eq!(pnl, 4_321);

        let noeracle = mock_noeracle::MockNoeracleClient::new(&f.env, &f.noeracle_id);
        assert_eq!(noeracle.recorded_price(), price);
        assert_eq!(
            noeracle.recorded_tag(),
            BytesN::from_array(&f.env, &[b'E', b'T', b'H', b'U', b'S', b'D', 0, 0])
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #31)")] // InvalidPrice (unknown asset)
    fn open_with_unknown_asset_errors() {
        let f = setup();
        let _ = f.client.open_with_price(
            &Address::generate(&f.env),
            &Symbol::new(&f.env, "PEPE"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
            &1i128,
            &1_700_000_000u64,
            &1u64,
            &pubkeys(&f.env),
            &sigs(&f.env),
        );
    }

    #[test]
    fn admin_can_rotate_market_and_noeracle() {
        let f = setup();
        let new_market = Address::generate(&f.env);
        let new_noeracle = Address::generate(&f.env);
        f.client.set_market(&new_market);
        f.client.set_noeracle(&new_noeracle);
        assert_eq!(f.client.get_market(), new_market);
        assert_eq!(f.client.get_noeracle(), new_noeracle);
    }

    #[test]
    fn admin_can_rotate_admin() {
        let f = setup();
        let new_admin = Address::generate(&f.env);
        f.client.set_admin(&new_admin);
        assert_eq!(f.client.get_admin(), new_admin);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Publisher allowlist (O-2 / P2-4)
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")] // Unauthorized
    fn foreign_publisher_key_rejected() {
        let f = setup();
        let foreign = soroban_sdk::vec![&f.env, BytesN::from_array(&f.env, &[42u8; 32])];
        let _ = f.client.open_with_price(
            &Address::generate(&f.env),
            &Symbol::new(&f.env, "BTC"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
            &(70_000 * PRECISION),
            &1_700_000_000u64,
            &1u64,
            &foreign,
            &sigs(&f.env),
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")] // Unauthorized
    fn empty_publisher_set_rejected() {
        let f = setup();
        let none: Vec<BytesN<32>> = soroban_sdk::vec![&f.env];
        let _ = f.client.open_with_price(
            &Address::generate(&f.env),
            &Symbol::new(&f.env, "BTC"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
            &(70_000 * PRECISION),
            &1_700_000_000u64,
            &1u64,
            &none,
            &sigs(&f.env),
        );
    }

    #[test]
    fn admin_can_rotate_publishers() {
        let f = setup();
        let new_keys = soroban_sdk::vec![&f.env, BytesN::from_array(&f.env, &[9u8; 32])];
        f.client.set_publishers(&new_keys);
        // Old key now rejected
        let res = f.client.try_open_with_price(
            &Address::generate(&f.env),
            &Symbol::new(&f.env, "BTC"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
            &(70_000 * PRECISION),
            &1_700_000_000u64,
            &1u64,
            &pubkeys(&f.env),
            &sigs(&f.env),
        );
        assert!(res.is_err());
    }

    // ═══════════════════════════════════════════════════════════════════
    // Keeper entry points (O-3 / P2-5)
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn liquidate_with_price_stores_then_liquidates() {
        let f = setup();
        let price = 65_000 * PRECISION;
        let reward = f.client.liquidate_with_price(
            &Address::generate(&f.env),
            &7u64,
            &Symbol::new(&f.env, "BTC"),
            &price,
            &1_700_000_000u64,
            &3u64,
            &pubkeys(&f.env),
            &sigs(&f.env),
        );
        assert_eq!(reward, 55);
        let noeracle = mock_noeracle::MockNoeracleClient::new(&f.env, &f.noeracle_id);
        assert_eq!(noeracle.recorded_price(), price);
    }

    #[test]
    fn execute_with_price_stores_then_executes() {
        let f = setup();
        let fee = f.client.execute_with_price(
            &Address::generate(&f.env),
            &12u64,
            &Symbol::new(&f.env, "ETH"),
            &(3_000 * PRECISION),
            &1_700_000_000u64,
            &4u64,
            &pubkeys(&f.env),
            &sigs(&f.env),
        );
        assert_eq!(fee, 66);
    }

    #[test]
    fn liquidate_cross_with_prices_refreshes_every_asset() {
        let f = setup();
        let atts = soroban_sdk::vec![
            &f.env,
            PriceAttestation {
                asset: Symbol::new(&f.env, "BTC"),
                price: 64_000 * PRECISION,
                timestamp: 1_700_000_000,
                round_id: 5,
                pubkeys: pubkeys(&f.env),
                sigs: sigs(&f.env),
            },
            PriceAttestation {
                asset: Symbol::new(&f.env, "XLM"),
                price: PRECISION / 10,
                timestamp: 1_700_000_000,
                round_id: 5,
                pubkeys: pubkeys(&f.env),
                sigs: sigs(&f.env),
            },
        ];
        let reward = f.client.liquidate_cross_with_prices(
            &Address::generate(&f.env),
            &Address::generate(&f.env),
            &atts,
        );
        assert_eq!(reward, 77);

        let noeracle = mock_noeracle::MockNoeracleClient::new(&f.env, &f.noeracle_id);
        let btc_tag = BytesN::from_array(&f.env, &[b'B', b'T', b'C', b'U', b'S', b'D', 0, 0]);
        let xlm_tag = BytesN::from_array(&f.env, &[b'X', b'L', b'M', b'U', b'S', b'D', 0, 0]);
        assert_eq!(noeracle.price_for(&btc_tag), 64_000 * PRECISION);
        assert_eq!(noeracle.price_for(&xlm_tag), PRECISION / 10);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Coarse sanity bounds (O-7 / P2-6)
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    #[should_panic(expected = "Error(Contract, #31)")] // InvalidPrice
    fn absurd_price_rejected_even_with_valid_publisher() {
        let f = setup();
        let _ = f.client.open_with_price(
            &Address::generate(&f.env),
            &Symbol::new(&f.env, "BTC"),
            &(100 * PRECISION),
            &5,
            &Direction::Long,
            &PRECISION, // BTC at $1 — below the 1k floor
            &1_700_000_000u64,
            &1u64,
            &pubkeys(&f.env),
            &sigs(&f.env),
        );
    }
}
