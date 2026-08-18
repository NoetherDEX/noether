//! # Noeracle SEP-40 Shim
//!
//! Translates the SEP-40 oracle interface the existing `oracle_adapter`
//! contract calls (`lastprice(asset: Symbol) -> (i128, u64)`) into
//! Noeracle's native interface (`get_price_pers(asset: BytesN<8>) -> Option<PriceEntry>`).
//!
//! This exists because the market contract is permanently bound to the
//! deployed `oracle_adapter` (no setter, no upgrade hook), and the
//! adapter calls oracles via `env.invoke_contract::<(i128, u64)>(...,
//! "lastprice", ...)`. Pointing the adapter at Noeracle directly would
//! fail — function name + asset-type + return-type all differ. This
//! shim sits in between and bridges the two interfaces, so the market
//! gets cryptographically-signed Noeracle prices without redeploying
//! anything in the trading path.
//!
//! ## Behaviour
//!
//! - Asset symbol → 8-byte tag mapping is hardcoded for the three
//!   currently-traded pairs (BTC, ETH, XLM). Adding a new pair requires
//!   a shim redeploy.
//! - On `get_price_pers` returning `None` (Noeracle persistent storage
//!   stale or empty), the shim panics with `NoetherError::OracleUnavailable`.
//!   This matches the existing adapter's panic-on-failure behaviour —
//!   trading halts loudly rather than serving stale prices silently.
//! - Admin can rotate the underlying Noeracle address without
//!   redeploying the shim.
//! - **Swappable backend (T3-D1 "Chainlink-ready"):** `set_backend` lets the
//!   admin repoint the shim at a STANDARD SEP-40 oracle (`lastprice(Asset)
//!   -> Option<PriceData>`, e.g. Reflector today or Chainlink when it ships
//!   on Stellar) instead of Noeracle's native interface — one admin call,
//!   with automatic decimal rescaling to Noether's 7. The market's oracle
//!   slot (this shim's address) never changes.

#![no_std]

use noether_common::NoetherError;
use soroban_sdk::{
    contract, contractimpl, contracttype, panic_with_error, Address, BytesN, Env, IntoVal,
    Symbol, Vec,
};

// ═══════════════════════════════════════════════════════════════════════════
// Storage Keys
// ═══════════════════════════════════════════════════════════════════════════

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    NoeracleOracle,
    Initialized,
    /// Backend interface mode (u32): absent/0 = Noeracle native
    /// `get_price_pers`, 1 = standard SEP-40 `lastprice(Asset)`.
    BackendMode,
    /// Backend price decimals (u32): absent = 7. Prices are rescaled to
    /// Noether's 7-decimal fixed point when this differs.
    BackendDecimals,
}

/// Backend interface modes for `set_backend`.
pub const BACKEND_NOERACLE: u32 = 0;
pub const BACKEND_SEP40: u32 = 1;

// ═══════════════════════════════════════════════════════════════════════════
// SEP-40 types (for the passthrough backend mode)
// ═══════════════════════════════════════════════════════════════════════════
//
// Mirrors the standard SEP-40 oracle interface (Reflector today, Chainlink
// when it ships on Stellar): `lastprice(asset: Asset) -> Option<PriceData>`.
// Variant/field names must match the standard or cross-contract decoding
// fails.

#[contracttype]
#[derive(Clone)]
pub enum Sep40Asset {
    Stellar(Address),
    Other(Symbol),
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Sep40PriceData {
    pub price: i128,
    pub timestamp: u64,
}

// ═══════════════════════════════════════════════════════════════════════════
// Noeracle PriceEntry — mirrors the contract's view-fn return type.
// ═══════════════════════════════════════════════════════════════════════════
//
// Mirrors Noeracle's on-chain `PriceEntry` return type EXACTLY — confirmed
// against oracle_v0/src/lib.rs (github.com/noeracle/noeracle): three fields
// (`price`, `timestamp`, `round_id`), no `asset`, no `sources`. Soroban
// serialises structs by field name, so these names + types must match the
// contract's or the `get_price_pers` return value fails to deserialise.

#[contracttype]
#[derive(Clone, Debug)]
pub struct NoeraclePriceEntry {
    pub price: i128,
    pub timestamp: u64,
    pub round_id: u64,
}

// ═══════════════════════════════════════════════════════════════════════════
// Contract Definition
// ═══════════════════════════════════════════════════════════════════════════

#[contract]
pub struct NoeracleShimContract;

#[contractimpl]
impl NoeracleShimContract {
    /// One-time setup. Records the admin (who can rotate the Noeracle
    /// address) and the Noeracle contract address itself.
    pub fn initialize(
        env: Env,
        admin: Address,
        noeracle_oracle: Address,
    ) -> Result<(), NoetherError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(NoetherError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::NoeracleOracle, &noeracle_oracle);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().extend_ttl(noether_common::ttl::TTL_THRESHOLD, noether_common::ttl::TTL_EXTEND_TO);
        Ok(())
    }

    /// SEP-40-compatible reader. The existing oracle_adapter contract
    /// calls this via `env.invoke_contract::<(i128, u64)>(...)`, so the
    /// return shape must be a bare tuple — we panic on missing data
    /// rather than returning `Result` or `Option`, both of which the
    /// caller can't decode into `(i128, u64)`.
    pub fn lastprice(env: Env, asset: Symbol) -> (i128, u64) {
        Self::require_initialized(&env);

        let backend: Address = env
            .storage()
            .instance()
            .get(&DataKey::NoeracleOracle)
            .unwrap_or_else(|| panic_with_error!(&env, NoetherError::NotInitialized));

        let mode: u32 = env
            .storage()
            .instance()
            .get(&DataKey::BackendMode)
            .unwrap_or(BACKEND_NOERACLE);

        let (price, timestamp) = if mode == BACKEND_SEP40 {
            // Standard SEP-40 passthrough: lastprice(Asset::Other(sym)).
            let args: Vec<soroban_sdk::Val> =
                (Sep40Asset::Other(asset.clone()),).into_val(&env);
            let data: Option<Sep40PriceData> =
                env.invoke_contract(&backend, &Symbol::new(&env, "lastprice"), args);
            match data {
                Some(d) => (d.price, d.timestamp),
                None => panic_with_error!(&env, NoetherError::OracleUnavailable),
            }
        } else {
            // Noeracle native path (default).
            let tag = match noether_common::assets::symbol_to_tag(&env, &asset) {
                Ok(t) => t,
                Err(e) => panic_with_error!(&env, e),
            };
            let args: Vec<soroban_sdk::Val> = (tag,).into_val(&env);
            let entry: Option<NoeraclePriceEntry> = env.invoke_contract(
                &backend,
                &Symbol::new(&env, "get_price_pers"),
                args,
            );
            match entry {
                Some(e) => (e.price, e.timestamp),
                None => panic_with_error!(&env, NoetherError::OracleUnavailable),
            }
        };

        (Self::rescale(&env, price), timestamp)
    }

    /// L0-9: time-weighted mean over the newest `records` ring entries,
    /// paired with the RING'S NEWEST timestamp so callers can age-bound
    /// liveness. (Upstream `twap` returns the bare mean; the newest entry
    /// comes from `prices(feed, 1)` — the oldest-used timestamp is not
    /// exposed upstream, and ring liveness is the operative bound.)
    /// Mode 1 (SEP-40) delegates twap to the vendor and reports "now" —
    /// age governance is the vendor's, documented divergence.
    /// None whenever the backend/ring cannot answer (<2 entries, unknown
    /// pair) — callers degrade to spot, never trap on None.
    pub fn twap(env: Env, asset: Symbol, records: u32) -> Option<(i128, u64)> {
        Self::require_initialized(&env);
        if records == 0 {
            return None;
        }
        let backend: Address = env.storage().instance().get(&DataKey::NoeracleOracle)?;
        let mode: u32 = env
            .storage()
            .instance()
            .get(&DataKey::BackendMode)
            .unwrap_or(BACKEND_NOERACLE);

        if mode == BACKEND_SEP40 {
            let args: Vec<soroban_sdk::Val> =
                (Sep40Asset::Other(asset.clone()), records).into_val(&env);
            let mean: Option<i128> =
                env.invoke_contract(&backend, &Symbol::new(&env, "twap"), args);
            return mean
                .filter(|value| *value > 0)
                .map(|value| (Self::rescale(&env, value), env.ledger().timestamp()));
        }

        let tag = noether_common::assets::symbol_to_tag(&env, &asset).ok()?;
        let args: Vec<soroban_sdk::Val> = (tag.clone(), records).into_val(&env);
        let mean: Option<i128> = env.invoke_contract(&backend, &Symbol::new(&env, "twap"), args);
        let mean = mean.filter(|value| *value > 0)?;

        let args: Vec<soroban_sdk::Val> = (tag, 1u32).into_val(&env);
        let newest: Option<Vec<NoeraclePriceEntry>> =
            env.invoke_contract(&backend, &Symbol::new(&env, "prices"), args);
        let newest_ts = newest.and_then(|ring| ring.first().map(|entry| entry.timestamp))?;

        Some((Self::rescale(&env, mean), newest_ts))
    }

    // ───────────────────────────────────────────────────────────────────────
    // Admin
    // ───────────────────────────────────────────────────────────────────────

    /// Point the shim at a different Noeracle deployment (e.g. mainnet
    /// migration, or testnet redeploy). Admin-authenticated. Rotates the
    /// address only — the backend mode/decimals are untouched, so this is
    /// for Noeracle→Noeracle moves; use `set_backend` to change vendor.
    pub fn set_noeracle_oracle(env: Env, new_oracle: Address) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::NoeracleOracle, &new_oracle);
        Ok(())
    }

    /// Swap the price backend in ONE admin call (T3-D1 "Chainlink-ready"):
    /// `mode` 0 = Noeracle native (`decimals` must be 7), 1 = standard
    /// SEP-40 `lastprice(Asset)` (e.g. Reflector at 14 decimals, Chainlink
    /// when it ships on Stellar). Prices from a backend with different
    /// decimals are rescaled to Noether's 7 on every read. The market keeps
    /// reading this shim's address throughout — no market change, ever.
    pub fn set_backend(
        env: Env,
        mode: u32,
        oracle: Address,
        decimals: u32,
    ) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        if mode > BACKEND_SEP40 || decimals > 18 {
            return Err(NoetherError::InvalidParameter);
        }
        if mode == BACKEND_NOERACLE && decimals != 7 {
            return Err(NoetherError::InvalidParameter);
        }
        env.storage().instance().set(&DataKey::NoeracleOracle, &oracle);
        env.storage().instance().set(&DataKey::BackendMode, &mode);
        env.storage().instance().set(&DataKey::BackendDecimals, &decimals);
        Ok(())
    }

    /// Rotate the admin address. Both old and new admins must sign.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        new_admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    /// Swap the running WASM in place (admin-gated). Future pair additions
    /// (new rows in noether_common::assets::PAIR_TAGS) then ship as an
    /// in-place upgrade — the shim keeps its address, so the market's
    /// oracle wiring never has to change.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    // ───────────────────────────────────────────────────────────────────────
    // Views
    // ───────────────────────────────────────────────────────────────────────

    pub fn get_admin(env: Env) -> Result<Address, NoetherError> {
        Self::require_initialized(&env);
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(NoetherError::NotInitialized)
    }

    pub fn get_noeracle(env: Env) -> Result<Address, NoetherError> {
        Self::require_initialized(&env);
        env.storage()
            .instance()
            .get(&DataKey::NoeracleOracle)
            .ok_or(NoetherError::NotInitialized)
    }

    /// Same precision as the rest of the Noether oracle chain.
    pub fn decimals(_env: Env) -> u32 {
        7
    }

    /// Current backend: (mode, oracle address, backend decimals).
    pub fn get_backend(env: Env) -> Result<(u32, Address, u32), NoetherError> {
        Self::require_initialized(&env);
        let oracle: Address = env
            .storage()
            .instance()
            .get(&DataKey::NoeracleOracle)
            .ok_or(NoetherError::NotInitialized)?;
        let mode: u32 = env
            .storage()
            .instance()
            .get(&DataKey::BackendMode)
            .unwrap_or(BACKEND_NOERACLE);
        let decimals: u32 = env
            .storage()
            .instance()
            .get(&DataKey::BackendDecimals)
            .unwrap_or(7);
        Ok((mode, oracle, decimals))
    }

    // ───────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ───────────────────────────────────────────────────────────────────────

    fn require_initialized(env: &Env) {
        if !env.storage().instance().has(&DataKey::Initialized) {
            panic_with_error!(env, NoetherError::NotInitialized);
        }
        // R-1: every price read re-arms the instance rent (no-op above the
        // threshold) — an archived shim would halt all trading, so the hot
        // path itself keeps it alive.
        env.storage().instance().extend_ttl(
            noether_common::ttl::TTL_THRESHOLD,
            noether_common::ttl::TTL_EXTEND_TO,
        );
    }

    /// Rescale a backend price to Noether's 7-decimal fixed point. A wrong
    /// or overflowing scale panics InvalidPrice — never serve a mis-scaled
    /// price to the market.
    fn rescale(env: &Env, price: i128) -> i128 {
        let decimals: u32 = env
            .storage()
            .instance()
            .get(&DataKey::BackendDecimals)
            .unwrap_or(7);
        if price <= 0 {
            panic_with_error!(env, NoetherError::InvalidPrice);
        }
        if decimals == 7 {
            return price;
        }
        if decimals > 7 {
            price / 10i128.pow(decimals - 7)
        } else {
            match price.checked_mul(10i128.pow(7 - decimals)) {
                Some(p) => p,
                None => panic_with_error!(env, NoetherError::InvalidPrice),
            }
        }
    }

    fn require_admin(env: &Env) -> Result<(), NoetherError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(NoetherError::NotInitialized);
        }
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
// Tests
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    // Mock Noeracle contract used by the integration tests below. Returns
    // a fixed PriceEntry for the BTC tag, None for everything else — so we
    // can exercise both the success and stale paths without standing up a
    // full Noeracle.
    mod mock_noeracle {
        use super::NoeraclePriceEntry;
        use soroban_sdk::{contract, contractimpl, BytesN, Env};

        #[contract]
        pub struct MockNoeracleContract;

        #[contractimpl]
        impl MockNoeracleContract {
            pub fn get_price_pers(_env: Env, asset: BytesN<8>) -> Option<NoeraclePriceEntry> {
                let bytes = asset.to_array();
                // BTC tag = b"BTCUSD\0\0"
                if bytes[..6] == [b'B', b'T', b'C', b'U', b'S', b'D'] {
                    return Some(NoeraclePriceEntry {
                        price: 700_000_000_000_000, // $70,000,000.0000000 — large, distinctive
                        timestamp: 1_700_000_000,
                        round_id: 42,
                    });
                }
                None
            }

            /// L0-9 ring views: BTC has a live ring (mean 690, newest ts
            /// 1_700_000_030); everything else has none.
            pub fn twap(_env: Env, asset: BytesN<8>, records: u32) -> Option<i128> {
                let bytes = asset.to_array();
                if records >= 2 && bytes[..6] == [b'B', b'T', b'C', b'U', b'S', b'D'] {
                    return Some(690_000_000_000_000);
                }
                None
            }

            pub fn prices(env: Env, asset: BytesN<8>, _records: u32) -> Option<soroban_sdk::Vec<NoeraclePriceEntry>> {
                let bytes = asset.to_array();
                if bytes[..6] == [b'B', b'T', b'C', b'U', b'S', b'D'] {
                    let mut out = soroban_sdk::Vec::new(&env);
                    out.push_back(NoeraclePriceEntry {
                        price: 700_000_000_000_000,
                        timestamp: 1_700_000_030,
                        round_id: 43,
                    });
                    return Some(out);
                }
                None
            }
        }
    }

    fn setup() -> (Env, Address, Address, NoeracleShimContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let mock_noeracle_id = env.register_contract(None, mock_noeracle::MockNoeracleContract);

        let shim_id = env.register_contract(None, NoeracleShimContract);
        let client = NoeracleShimContractClient::new(&env, &shim_id);
        client.initialize(&admin, &mock_noeracle_id);

        (env, admin, mock_noeracle_id, client)
    }

    #[test]
    fn initialize_records_admin_and_noeracle() {
        let (_, admin, noeracle, client) = setup();
        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.get_noeracle(), noeracle);
    }

    /// R-1: every price read must re-arm the instance rent — an archived
    /// shim would halt all trading.
    #[test]
    fn lastprice_rearms_instance_ttl() {
        use soroban_sdk::testutils::storage::Instance as _;
        use soroban_sdk::testutils::Ledger as _;

        let (env, _admin, noeracle, client) = setup();
        let id = client.address.clone();

        // Keep the MOCK backend alive across the jump — only the shim's own
        // TTL behaviour is under test here.
        env.as_contract(&noeracle, || {
            env.storage().instance().extend_ttl(
                noether_common::ttl::TTL_EXTEND_TO * 2,
                noether_common::ttl::TTL_EXTEND_TO * 2,
            );
        });

        env.ledger().with_mut(|li| {
            li.sequence_number += noether_common::ttl::TTL_EXTEND_TO - 1_000
        });
        let before = env.as_contract(&id, || env.storage().instance().get_ttl());
        assert!(
            before < noether_common::ttl::TTL_THRESHOLD,
            "precondition: inside the re-extend window"
        );

        client.lastprice(&Symbol::new(&env, "BTC"));

        let after = env.as_contract(&id, || env.storage().instance().get_ttl());
        assert_eq!(
            after,
            noether_common::ttl::TTL_EXTEND_TO,
            "price read must re-arm the instance TTL"
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")] // AlreadyInitialized
    fn initialize_twice_errors() {
        let (env, admin, noeracle, client) = setup();
        let _ = (env, admin, noeracle);
        client.initialize(&Address::generate(&client.env), &client.address);
    }

    #[test]
    fn lastprice_btc_returns_mocked_price() {
        let (env, _, _, client) = setup();
        let (price, ts) = client.lastprice(&Symbol::new(&env, "BTC"));
        assert_eq!(price, 700_000_000_000_000);
        assert_eq!(ts, 1_700_000_000);
    }

    #[test]
    fn twap_btc_returns_mean_with_newest_ring_timestamp() {
        // L0-9: mean from the upstream twap view, liveness timestamp from
        // the ring's newest entry (prices(feed, 1)).
        let (env, _, _, client) = setup();
        let result = client.twap(&Symbol::new(&env, "BTC"), &4);
        assert_eq!(result, Some((690_000_000_000_000, 1_700_000_030)));
    }

    #[test]
    fn twap_none_propagates_for_unknown_pair_and_zero_records() {
        // The mock has no ETH ring; records=0 is the caller-side kill
        // switch. Both degrade to None — spot-only behavior, never a trap.
        let (env, _, _, client) = setup();
        assert_eq!(client.twap(&Symbol::new(&env, "ETH"), &4), None);
        assert_eq!(client.twap(&Symbol::new(&env, "BTC"), &0), None);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #32)")] // OracleUnavailable
    fn lastprice_eth_panics_when_unavailable() {
        // The mock returns None for non-BTC tags, exercising the "no
        // persistent entry" path. Real keeper failure would look the same.
        let (env, _, _, client) = setup();
        let _ = client.lastprice(&Symbol::new(&env, "ETH"));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #31)")] // InvalidPrice (unknown asset)
    fn lastprice_unknown_symbol_panics() {
        let (env, _, _, client) = setup();
        let _ = client.lastprice(&Symbol::new(&env, "PEPE"));
    }

    #[test]
    fn admin_can_rotate_noeracle() {
        let (env, _, _, client) = setup();
        let new_noeracle = Address::generate(&env);
        client.set_noeracle_oracle(&new_noeracle);
        assert_eq!(client.get_noeracle(), new_noeracle);
    }

    #[test]
    fn admin_can_rotate_admin() {
        let (env, _, _, client) = setup();
        let new_admin = Address::generate(&env);
        client.set_admin(&new_admin);
        assert_eq!(client.get_admin(), new_admin);
    }

    #[test]
    fn decimals_is_seven() {
        let (_, _, _, client) = setup();
        assert_eq!(client.decimals(), 7);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Swappable backend (T3-D1 "Chainlink-ready")
    // ═══════════════════════════════════════════════════════════════════

    // Mock standard SEP-40 oracle (Reflector-style, 14 decimals): returns a
    // fixed price for Asset::Other("BTC"), None otherwise.
    mod mock_sep40 {
        use super::{Sep40Asset, Sep40PriceData};
        use soroban_sdk::{contract, contractimpl, Env, Symbol};

        #[contract]
        pub struct MockSep40Contract;

        #[contractimpl]
        impl MockSep40Contract {
            pub fn lastprice(env: Env, asset: Sep40Asset) -> Option<Sep40PriceData> {
                match asset {
                    Sep40Asset::Other(sym) if sym == Symbol::new(&env, "BTC") => {
                        Some(Sep40PriceData {
                            // $70,000 at 14 decimals
                            price: 7_000_000_000_000_000_000,
                            timestamp: 1_700_000_100,
                        })
                    }
                    _ => None,
                }
            }

            /// L0-9 mode-1 passthrough target: $69,000 mean at 14 decimals.
            pub fn twap(env: Env, asset: Sep40Asset, _records: u32) -> Option<i128> {
                match asset {
                    Sep40Asset::Other(sym) if sym == Symbol::new(&env, "BTC") => {
                        Some(6_900_000_000_000_000_000)
                    }
                    _ => None,
                }
            }
        }
    }

    #[test]
    fn set_backend_swaps_to_sep40_and_rescales() {
        let (env, _, _, client) = setup();
        let sep40_id = env.register_contract(None, mock_sep40::MockSep40Contract);

        // One admin call: vendor swap to a standard SEP-40 feed at 14 dp.
        client.set_backend(&BACKEND_SEP40, &sep40_id, &14u32);

        let (price, ts) = client.lastprice(&Symbol::new(&env, "BTC"));
        // 7e18 (14 dp) → 7e11 (7 dp) = $70,000.0000000
        assert_eq!(price, 700_000_000_000);
        assert_eq!(ts, 1_700_000_100);
        assert_eq!(client.get_backend(), (BACKEND_SEP40, sep40_id, 14u32));

        // L0-9: mode-1 twap rescales the vendor mean the same way; the
        // timestamp is "now" (age governance is the vendor's).
        let twap = client.twap(&Symbol::new(&env, "BTC"), &4).unwrap();
        assert_eq!(twap.0, 690_000_000_000);
        assert_eq!(twap.1, env.ledger().timestamp());
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #32)")] // OracleUnavailable
    fn sep40_backend_none_panics_unavailable() {
        let (env, _, _, client) = setup();
        let sep40_id = env.register_contract(None, mock_sep40::MockSep40Contract);
        client.set_backend(&BACKEND_SEP40, &sep40_id, &14u32);
        // Mock returns None for ETH — must halt loudly, same as Noeracle path.
        let _ = client.lastprice(&Symbol::new(&env, "ETH"));
    }

    #[test]
    fn set_backend_swaps_back_to_noeracle() {
        let (env, _, noeracle, client) = setup();
        let sep40_id = env.register_contract(None, mock_sep40::MockSep40Contract);
        client.set_backend(&BACKEND_SEP40, &sep40_id, &14u32);

        // And back — the reversibility half of the Chainlink-ready story.
        client.set_backend(&BACKEND_NOERACLE, &noeracle, &7u32);
        let (price, ts) = client.lastprice(&Symbol::new(&env, "BTC"));
        assert_eq!(price, 700_000_000_000_000);
        assert_eq!(ts, 1_700_000_000);
    }

    #[test]
    fn set_backend_rejects_bad_params() {
        let (env, _, noeracle, client) = setup();
        // Unknown mode
        assert_eq!(
            client.try_set_backend(&2u32, &noeracle, &7u32),
            Err(Ok(NoetherError::InvalidParameter))
        );
        // Absurd decimals
        assert_eq!(
            client.try_set_backend(&BACKEND_SEP40, &noeracle, &19u32),
            Err(Ok(NoetherError::InvalidParameter))
        );
        // Noeracle mode must stay at 7 decimals
        assert_eq!(
            client.try_set_backend(&BACKEND_NOERACLE, &noeracle, &14u32),
            Err(Ok(NoetherError::InvalidParameter))
        );
        let _ = env;
    }

    #[test]
    fn default_backend_is_noeracle_native() {
        // A shim deployed/initialized without ever calling set_backend must
        // behave exactly as before the feature existed (storage-compatible
        // with the live instance).
        let (env, _, noeracle, client) = setup();
        assert_eq!(client.get_backend(), (BACKEND_NOERACLE, noeracle, 7u32));
        let (price, _) = client.lastprice(&Symbol::new(&env, "BTC"));
        assert_eq!(price, 700_000_000_000_000);
    }
}
