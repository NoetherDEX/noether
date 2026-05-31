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

use noether_common::{Direction, NoetherError, Position};
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
}

#[contract]
pub struct NoetherRouterContract;

#[contractimpl]
impl NoetherRouterContract {
    /// One-time setup. Records the admin (who can rotate the market / Noeracle
    /// addresses) plus the market and Noeracle contract addresses.
    pub fn initialize(
        env: Env,
        admin: Address,
        market: Address,
        noeracle: Address,
    ) -> Result<(), NoetherError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(NoetherError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Market, &market);
        env.storage().instance().set(&DataKey::Noeracle, &noeracle);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().extend_ttl(518_400, 518_400);
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

    // ───────────────────────────────────────────────────────────────────────
    // Admin
    // ───────────────────────────────────────────────────────────────────────

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

// ═══════════════════════════════════════════════════════════════════════════
// Symbol → 8-byte tag mapping
// ═══════════════════════════════════════════════════════════════════════════
//
// Identical to `noeracle_shim::symbol_to_tag`: Noeracle's on-chain tag is
// `ASCII(<symbol>USD)` zero-padded to 8 bytes. Deriving it here (rather than
// trusting a caller-supplied tag) guarantees the slot this router WRITES is the
// same slot the shim READS for the market. Hardcoded for the three trading
// pairs; adding a pair means a redeploy of both this and the shim.

fn symbol_to_tag(env: &Env, asset: &Symbol) -> Result<BytesN<8>, NoetherError> {
    let btc = Symbol::new(env, "BTC");
    let eth = Symbol::new(env, "ETH");
    let xlm = Symbol::new(env, "XLM");

    let bytes: [u8; 8] = if asset == &btc {
        [b'B', b'T', b'C', b'U', b'S', b'D', 0, 0]
    } else if asset == &eth {
        [b'E', b'T', b'H', b'U', b'S', b'D', 0, 0]
    } else if asset == &xlm {
        [b'X', b'L', b'M', b'U', b'S', b'D', 0, 0]
    } else {
        return Err(NoetherError::InvalidPrice);
    };

    Ok(BytesN::from_array(env, &bytes))
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
                let _ = (timestamp, round_id, pubkeys, sigs);
            }

            pub fn recorded_price(env: Env) -> i128 {
                env.storage().instance().get(&symbol_short!("PRICE")).unwrap_or(0)
            }

            pub fn recorded_tag(env: Env) -> BytesN<8> {
                env.storage().instance().get(&symbol_short!("TAG")).unwrap()
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
        client.initialize(&admin, &market_id, &noeracle_id);
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
        f.client.initialize(&f.admin, &f.market_id, &f.noeracle_id);
    }

    #[test]
    fn open_with_price_stores_then_opens() {
        let f = setup();
        let price = 700_000_000_000_000i128;
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
            &Symbol::new(&f.env, "DOGE"),
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
}
