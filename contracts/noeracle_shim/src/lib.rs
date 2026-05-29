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

#![no_std]

use noether_common::NoetherError;
use soroban_sdk::{
    contract, contractimpl, contracttype, panic_with_error, Address, BytesN, Env, IntoVal, Symbol,
    Vec,
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
        env.storage().instance().extend_ttl(518_400, 518_400);
        Ok(())
    }

    /// SEP-40-compatible reader. The existing oracle_adapter contract
    /// calls this via `env.invoke_contract::<(i128, u64)>(...)`, so the
    /// return shape must be a bare tuple — we panic on missing data
    /// rather than returning `Result` or `Option`, both of which the
    /// caller can't decode into `(i128, u64)`.
    pub fn lastprice(env: Env, asset: Symbol) -> (i128, u64) {
        Self::require_initialized(&env);

        let noeracle: Address = env
            .storage()
            .instance()
            .get(&DataKey::NoeracleOracle)
            .unwrap_or_else(|| panic_with_error!(&env, NoetherError::NotInitialized));

        let tag = symbol_to_tag(&env, &asset);

        // Build the args Vec the way Soroban expects for invoke_contract.
        let args: Vec<soroban_sdk::Val> = (tag,).into_val(&env);
        let entry: Option<NoeraclePriceEntry> = env.invoke_contract(
            &noeracle,
            &Symbol::new(&env, "get_price_pers"),
            args,
        );

        match entry {
            Some(e) => (e.price, e.timestamp),
            None => panic_with_error!(&env, NoetherError::OracleUnavailable),
        }
    }

    // ───────────────────────────────────────────────────────────────────────
    // Admin
    // ───────────────────────────────────────────────────────────────────────

    /// Point the shim at a different Noeracle deployment (e.g. mainnet
    /// migration, or testnet redeploy). Admin-authenticated.
    pub fn set_noeracle_oracle(env: Env, new_oracle: Address) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::NoeracleOracle, &new_oracle);
        Ok(())
    }

    /// Rotate the admin address. Both old and new admins must sign.
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

    // ───────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ───────────────────────────────────────────────────────────────────────

    fn require_initialized(env: &Env) {
        if !env.storage().instance().has(&DataKey::Initialized) {
            panic_with_error!(env, NoetherError::NotInitialized);
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
// Symbol → 8-byte tag mapping
// ═══════════════════════════════════════════════════════════════════════════
//
// Noeracle's on-chain tag is `ASCII(<symbol>USD)` padded to 8 bytes with
// trailing zeros — confirmed against the live attestation messages from
// api.noeracle.org (the first 8 bytes of the signed message). Hardcoded
// for the three trading pairs; adding a pair means a shim redeploy.

fn symbol_to_tag(env: &Env, asset: &Symbol) -> BytesN<8> {
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
        panic_with_error!(env, NoetherError::InvalidPrice);
    };

    BytesN::from_array(env, &bytes)
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
        let _ = client.lastprice(&Symbol::new(&env, "DOGE"));
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
}
