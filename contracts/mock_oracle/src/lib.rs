//! # Mock Oracle Contract
//!
//! A simple oracle for local development and testing.
//! Allows admin to set arbitrary prices for any asset.
//!
//! This contract mimics the SEP-0040 oracle interface used by Band and DIA.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Vec};
use noether_common::{NoetherError, PriceData, PRECISION};

// ═══════════════════════════════════════════════════════════════════════════
// Storage Keys
// ═══════════════════════════════════════════════════════════════════════════

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Admin address who can set prices
    Admin,
    /// Price for a specific asset: DataKey::Price(Symbol) -> StoredPrice
    Price(Symbol),
    /// Whether the oracle is initialized
    Initialized,
}

/// Stored price data with timestamp
#[contracttype]
#[derive(Clone, Debug)]
pub struct StoredPrice {
    pub price: i128,
    pub timestamp: u64,
}

// ═══════════════════════════════════════════════════════════════════════════
// Contract Definition
// ═══════════════════════════════════════════════════════════════════════════

#[contract]
pub struct MockOracleContract;

#[contractimpl]
impl MockOracleContract {
    // ═══════════════════════════════════════════════════════════════════════
    // Initialization
    // ═══════════════════════════════════════════════════════════════════════

    /// Initialize the mock oracle with an admin address.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `admin` - Address that can set prices
    ///
    /// # Errors
    /// * `AlreadyInitialized` - Contract was already initialized
    pub fn initialize(env: Env, admin: Address) -> Result<(), NoetherError> {
        // Check not already initialized
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(NoetherError::AlreadyInitialized);
        }

        // Require admin authorization
        admin.require_auth();

        // Store admin and mark as initialized
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Initialized, &true);

        // Extend TTL for instance storage (30 days)
        env.storage().instance().extend_ttl(2_592_000, 2_592_000);

        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Admin Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Set the price for an asset (admin only).
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `asset` - Asset symbol (e.g., "XLM", "BTC")
    /// * `price` - Price with 7 decimals (1.0 = 10_000_000)
    ///
    /// # Errors
    /// * `NotInitialized` - Contract not initialized
    /// * `Unauthorized` - Caller is not admin
    /// * `InvalidPrice` - Price is zero or negative
    pub fn set_price(env: Env, asset: Symbol, price: i128) -> Result<(), NoetherError> {
        Self::require_initialized(&env)?;
        Self::require_admin(&env)?;

        // Validate price
        if price <= 0 {
            return Err(NoetherError::InvalidPrice);
        }

        // Store the price with current timestamp
        let stored_price = StoredPrice {
            price,
            timestamp: env.ledger().timestamp(),
        };

        env.storage().persistent().set(&DataKey::Price(asset.clone()), &stored_price);

        // Extend TTL for this price data (7 days)
        env.storage().persistent().extend_ttl(&DataKey::Price(asset), 604_800, 604_800);

        Ok(())
    }

    /// Set prices for multiple assets at once (admin only).
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `assets` - Vector of asset symbols
    /// * `prices` - Vector of prices (same length as assets)
    pub fn set_prices(
        env: Env,
        assets: Vec<Symbol>,
        prices: Vec<i128>,
    ) -> Result<(), NoetherError> {
        Self::require_initialized(&env)?;
        Self::require_admin(&env)?;

        if assets.len() != prices.len() {
            return Err(NoetherError::InvalidParameter);
        }

        let timestamp = env.ledger().timestamp();

        for i in 0..assets.len() {
            let asset = assets.get(i).unwrap();
            let price = prices.get(i).unwrap();

            if price <= 0 {
                return Err(NoetherError::InvalidPrice);
            }

            let stored_price = StoredPrice { price, timestamp };
            env.storage().persistent().set(&DataKey::Price(asset.clone()), &stored_price);
            env.storage().persistent().extend_ttl(&DataKey::Price(asset), 604_800, 604_800);
        }

        Ok(())
    }

    /// Transfer admin role to a new address.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), NoetherError> {
        Self::require_initialized(&env)?;
        Self::require_admin(&env)?;
        new_admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Price Query Functions (SEP-0040 Compatible Interface)
    // ═══════════════════════════════════════════════════════════════════════

    /// Get the last price for an asset.
    /// This matches the SEP-0040 oracle interface.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `asset` - Asset symbol (e.g., "XLM")
    ///
    /// # Returns
    /// Tuple of (price, timestamp) - price has 7 decimals
    ///
    /// # Errors
    /// * `AssetNotSupported` - No price set for this asset
    pub fn lastprice(env: Env, asset: Symbol) -> Result<(i128, u64), NoetherError> {
        Self::require_initialized(&env)?;

        let stored: StoredPrice = env
            .storage()
            .persistent()
            .get(&DataKey::Price(asset.clone()))
            .ok_or(NoetherError::AssetNotSupported)?;

        Ok((stored.price, stored.timestamp))
    }

    /// Alternative name for compatibility (lowercase).
    pub fn last_price(env: Env, asset: Symbol) -> Result<(i128, u64), NoetherError> {
        Self::lastprice(env, asset)
    }

    /// Get price with full PriceData struct.
    pub fn get_price(env: Env, asset: Symbol) -> Result<PriceData, NoetherError> {
        let (price, timestamp) = Self::lastprice(env, asset)?;
        Ok(PriceData { price, timestamp })
    }

    /// Get prices for multiple assets.
    pub fn get_prices(env: Env, assets: Vec<Symbol>) -> Result<Vec<PriceData>, NoetherError> {
        Self::require_initialized(&env)?;

        let mut prices = Vec::new(&env);

        for i in 0..assets.len() {
            let asset = assets.get(i).unwrap();
            let price_data = Self::get_price(env.clone(), asset)?;
            prices.push_back(price_data);
        }

        Ok(prices)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // View Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Get the admin address.
    pub fn get_admin(env: Env) -> Result<Address, NoetherError> {
        Self::require_initialized(&env)?;
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(NoetherError::NotInitialized)
    }

    /// Check if a price exists for an asset.
    pub fn has_price(env: Env, asset: Symbol) -> bool {
        env.storage().persistent().has(&DataKey::Price(asset))
    }

    /// Get the base precision (7 decimals).
    pub fn decimals(_env: Env) -> u32 {
        7
    }

    /// Get the precision value (10^7).
    pub fn precision(_env: Env) -> i128 {
        PRECISION
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Internal Helpers
    // ═══════════════════════════════════════════════════════════════════════

    /// Verify contract is initialized.
    fn require_initialized(env: &Env) -> Result<(), NoetherError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(NoetherError::NotInitialized);
        }
        Ok(())
    }

    /// Verify caller is admin and require their authorization.
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
// Tests
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    fn setup_env() -> (Env, Address, MockOracleContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, MockOracleContract);
        let client = MockOracleContractClient::new(&env, &contract_id);

        (env, admin, client)
    }

    #[test]
    fn test_initialize() {
        let (env, admin, client) = setup_env();

        client.initialize(&admin);

        let stored_admin = client.get_admin();
        assert_eq!(stored_admin, admin);
    }

    #[test]
    #[should_panic(expected = "AlreadyInitialized")]
    fn test_double_initialize() {
        let (env, admin, client) = setup_env();

        client.initialize(&admin);
        client.initialize(&admin); // Should panic
    }

    #[test]
    fn test_set_and_get_price() {
        let (env, admin, client) = setup_env();
        client.initialize(&admin);

        // Set timestamp
        env.ledger().set_timestamp(1000);

        // Set XLM price to $0.15 (1,500,000 with 7 decimals)
        let xlm = Symbol::new(&env, "XLM");
        let xlm_price = 1_500_000i128; // $0.15

        client.set_price(&xlm, &xlm_price);

        // Get price
        let (price, timestamp) = client.lastprice(&xlm);
        assert_eq!(price, xlm_price);
        assert_eq!(timestamp, 1000);
    }

    #[test]
    fn test_set_multiple_prices() {
        let (env, admin, client) = setup_env();
        client.initialize(&admin);

        let assets = Vec::from_array(
            &env,
            [Symbol::new(&env, "XLM"), Symbol::new(&env, "BTC")],
        );
        let prices = Vec::from_array(&env, [1_500_000i128, 500_000_000_000i128]); // $0.15, $50,000

        client.set_prices(&assets, &prices);

        let (xlm_price, _) = client.lastprice(&Symbol::new(&env, "XLM"));
        let (btc_price, _) = client.lastprice(&Symbol::new(&env, "BTC"));

        assert_eq!(xlm_price, 1_500_000);
        assert_eq!(btc_price, 500_000_000_000);
    }

    #[test]
    fn test_get_price_data() {
        let (env, admin, client) = setup_env();
        client.initialize(&admin);

        env.ledger().set_timestamp(12345);

        let xlm = Symbol::new(&env, "XLM");
        client.set_price(&xlm, &1_500_000i128);

        let price_data = client.get_price(&xlm);
        assert_eq!(price_data.price, 1_500_000);
        assert_eq!(price_data.timestamp, 12345);
    }

    #[test]
    #[should_panic(expected = "AssetNotSupported")]
    fn test_get_nonexistent_price() {
        let (env, admin, client) = setup_env();
        client.initialize(&admin);

        let unknown = Symbol::new(&env, "UNKNOWN");
        client.lastprice(&unknown); // Should panic
    }

    #[test]
    #[should_panic(expected = "InvalidPrice")]
    fn test_invalid_price() {
        let (env, admin, client) = setup_env();
        client.initialize(&admin);

        let xlm = Symbol::new(&env, "XLM");
        client.set_price(&xlm, &0i128); // Should panic
    }

    #[test]
    fn test_has_price() {
        let (env, admin, client) = setup_env();
        client.initialize(&admin);

        let xlm = Symbol::new(&env, "XLM");
        let btc = Symbol::new(&env, "BTC");

        assert!(!client.has_price(&xlm));

        client.set_price(&xlm, &1_500_000i128);

        assert!(client.has_price(&xlm));
        assert!(!client.has_price(&btc));
    }

    #[test]
    fn test_precision() {
        let (env, _, client) = setup_env();

        assert_eq!(client.decimals(), 7);
        assert_eq!(client.precision(), 10_000_000);
    }
}
