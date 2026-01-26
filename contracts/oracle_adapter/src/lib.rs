//! # Oracle Adapter Contract
//!
//! Aggregates prices from Band Protocol and DIA oracles.
//! Implements safety checks for staleness and deviation.
//!
//! ## Features
//! - Fetches prices from both Band and DIA oracles
//! - Validates price freshness (staleness check)
//! - Validates price consistency (deviation check)
//! - Falls back to single oracle if one fails (configurable)
//! - Admin controls for oracle configuration

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Vec};
use noether_common::{NoetherError, PriceData, OraclePriceData, OracleConfig, BASIS_POINTS};

mod external;

// ═══════════════════════════════════════════════════════════════════════════
// Storage Keys
// ═══════════════════════════════════════════════════════════════════════════

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Admin address
    Admin,
    /// Primary oracle address (Band)
    PrimaryOracle,
    /// Secondary oracle address (DIA)
    SecondaryOracle,
    /// Maximum price staleness in seconds
    MaxStaleness,
    /// Maximum deviation between oracles in basis points
    MaxDeviation,
    /// Whether both oracles are required
    RequireBoth,
    /// Whether contract is initialized
    Initialized,
    /// Whether contract is paused
    Paused,
    /// Cached price for an asset (Symbol -> CachedPrice)
    CachedPrice(Symbol),
}

/// Cached price with metadata
#[contracttype]
#[derive(Clone, Debug)]
pub struct CachedPrice {
    pub price: i128,
    pub timestamp: u64,
    pub primary_available: bool,
    pub secondary_available: bool,
}

// ═══════════════════════════════════════════════════════════════════════════
// Contract Definition
// ═══════════════════════════════════════════════════════════════════════════

#[contract]
pub struct OracleAdapterContract;

#[contractimpl]
impl OracleAdapterContract {
    // ═══════════════════════════════════════════════════════════════════════
    // Initialization
    // ═══════════════════════════════════════════════════════════════════════

    /// Initialize the oracle adapter with configuration.
    ///
    /// # Arguments
    /// * `admin` - Admin address for configuration changes
    /// * `primary_oracle` - Band Protocol oracle contract address
    /// * `secondary_oracle` - DIA oracle contract address
    /// * `max_staleness` - Maximum allowed price age in seconds (default: 60)
    /// * `max_deviation_bps` - Maximum allowed deviation in basis points (default: 100 = 1%)
    pub fn initialize(
        env: Env,
        admin: Address,
        primary_oracle: Address,
        secondary_oracle: Address,
        max_staleness: u64,
        max_deviation_bps: u32,
    ) -> Result<(), NoetherError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(NoetherError::AlreadyInitialized);
        }

        admin.require_auth();

        // Store configuration
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::PrimaryOracle, &primary_oracle);
        env.storage().instance().set(&DataKey::SecondaryOracle, &secondary_oracle);
        env.storage().instance().set(&DataKey::MaxStaleness, &max_staleness);
        env.storage().instance().set(&DataKey::MaxDeviation, &max_deviation_bps);
        env.storage().instance().set(&DataKey::RequireBoth, &false); // Allow single oracle fallback
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Paused, &false);

        // Extend TTL
        env.storage().instance().extend_ttl(2_592_000, 2_592_000);

        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Price Query Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Get the aggregated price for an asset.
    /// This is the main function used by other contracts.
    ///
    /// # Algorithm
    /// 1. Fetch prices from both oracles
    /// 2. Check staleness for each price
    /// 3. If both available, check deviation and return average
    /// 4. If only one available (and require_both is false), return that price
    /// 5. If none available, return error
    pub fn get_price(env: Env, asset: Symbol) -> Result<OraclePriceData, NoetherError> {
        Self::require_initialized(&env)?;
        Self::require_not_paused(&env)?;

        let current_time = env.ledger().timestamp();
        let max_staleness: u64 = env.storage().instance().get(&DataKey::MaxStaleness).unwrap_or(60);
        let max_deviation: u32 = env.storage().instance().get(&DataKey::MaxDeviation).unwrap_or(100);
        let require_both: bool = env.storage().instance().get(&DataKey::RequireBoth).unwrap_or(false);

        // Fetch from primary oracle (Band)
        let primary_result = Self::fetch_primary_price(&env, &asset);

        // Fetch from secondary oracle (DIA)
        let secondary_result = Self::fetch_secondary_price(&env, &asset);

        // Process results
        let primary_valid = primary_result
            .as_ref()
            .map(|p| !Self::is_stale(p.timestamp, current_time, max_staleness))
            .unwrap_or(false);

        let secondary_valid = secondary_result
            .as_ref()
            .map(|p| !Self::is_stale(p.timestamp, current_time, max_staleness))
            .unwrap_or(false);

        // Case 1: Both oracles available and valid
        if primary_valid && secondary_valid {
            let primary_price = primary_result.as_ref().unwrap();
            let secondary_price = secondary_result.as_ref().unwrap();

            // Check deviation
            if Self::deviation_too_high(primary_price.price, secondary_price.price, max_deviation) {
                return Err(NoetherError::InvalidPrice);
            }

            // Return average price
            let avg_price = (primary_price.price + secondary_price.price) / 2;
            let latest_timestamp = primary_price.timestamp.max(secondary_price.timestamp);

            // Cache the result
            Self::cache_price(&env, &asset, avg_price, latest_timestamp, true, true);

            return Ok(OraclePriceData {
                price: avg_price,
                timestamp: latest_timestamp,
                source: Symbol::new(&env, "aggregated"),
                confidence: 10000, // 100% confidence when both agree
            });
        }

        // Case 2: Only one oracle available
        if !require_both {
            if primary_valid {
                let price = primary_result.unwrap();
                Self::cache_price(&env, &asset, price.price, price.timestamp, true, false);

                return Ok(OraclePriceData {
                    price: price.price,
                    timestamp: price.timestamp,
                    source: Symbol::new(&env, "band"),
                    confidence: 8000, // 80% confidence with single oracle
                });
            }

            if secondary_valid {
                let price = secondary_result.unwrap();
                Self::cache_price(&env, &asset, price.price, price.timestamp, false, true);

                return Ok(OraclePriceData {
                    price: price.price,
                    timestamp: price.timestamp,
                    source: Symbol::new(&env, "dia"),
                    confidence: 8000,
                });
            }
        }

        // Case 3: No valid prices
        Err(NoetherError::OracleUnavailable)
    }

    /// Get price as simple tuple (SEP-0040 compatible).
    pub fn lastprice(env: Env, asset: Symbol) -> Result<(i128, u64), NoetherError> {
        let price_data = Self::get_price(env, asset)?;
        Ok((price_data.price, price_data.timestamp))
    }

    /// Get price as PriceData struct.
    pub fn get_price_data(env: Env, asset: Symbol) -> Result<PriceData, NoetherError> {
        let price_data = Self::get_price(env, asset)?;
        Ok(PriceData {
            price: price_data.price,
            timestamp: price_data.timestamp,
        })
    }

    /// Get prices for multiple assets.
    pub fn get_prices(env: Env, assets: Vec<Symbol>) -> Result<Vec<OraclePriceData>, NoetherError> {
        let mut prices = Vec::new(&env);

        for i in 0..assets.len() {
            let asset = assets.get(i).unwrap();
            let price = Self::get_price(env.clone(), asset)?;
            prices.push_back(price);
        }

        Ok(prices)
    }

    /// Get the cached price (may be stale).
    pub fn get_cached_price(env: Env, asset: Symbol) -> Option<CachedPrice> {
        env.storage().persistent().get(&DataKey::CachedPrice(asset))
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Admin Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Update the primary oracle address.
    pub fn set_primary_oracle(env: Env, new_oracle: Address) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::PrimaryOracle, &new_oracle);
        Ok(())
    }

    /// Update the secondary oracle address.
    pub fn set_secondary_oracle(env: Env, new_oracle: Address) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::SecondaryOracle, &new_oracle);
        Ok(())
    }

    /// Update maximum staleness threshold.
    pub fn set_max_staleness(env: Env, max_seconds: u64) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::MaxStaleness, &max_seconds);
        Ok(())
    }

    /// Update maximum deviation threshold.
    pub fn set_max_deviation(env: Env, max_bps: u32) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::MaxDeviation, &max_bps);
        Ok(())
    }

    /// Set whether both oracles are required.
    pub fn set_require_both(env: Env, require_both: bool) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::RequireBoth, &require_both);
        Ok(())
    }

    /// Pause the oracle adapter (emergency).
    pub fn pause(env: Env) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        Ok(())
    }

    /// Unpause the oracle adapter.
    pub fn unpause(env: Env) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    /// Transfer admin role.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), NoetherError> {
        Self::require_admin(&env)?;
        new_admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // View Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Get current configuration.
    pub fn get_config(env: Env) -> Result<OracleConfig, NoetherError> {
        Self::require_initialized(&env)?;

        Ok(OracleConfig {
            primary_oracle: env.storage().instance().get(&DataKey::PrimaryOracle).unwrap(),
            secondary_oracle: env.storage().instance().get(&DataKey::SecondaryOracle).unwrap(),
            max_staleness: env.storage().instance().get(&DataKey::MaxStaleness).unwrap_or(60),
            max_deviation_bps: env.storage().instance().get(&DataKey::MaxDeviation).unwrap_or(100),
            require_both: env.storage().instance().get(&DataKey::RequireBoth).unwrap_or(false),
        })
    }

    /// Get admin address.
    pub fn get_admin(env: Env) -> Result<Address, NoetherError> {
        Self::require_initialized(&env)?;
        env.storage().instance().get(&DataKey::Admin).ok_or(NoetherError::NotInitialized)
    }

    /// Check if contract is paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
    }

    /// Get precision (7 decimals).
    pub fn decimals(_env: Env) -> u32 {
        7
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Internal Functions
    // ═══════════════════════════════════════════════════════════════════════

    /// Fetch price from primary oracle (Band Protocol).
    fn fetch_primary_price(env: &Env, asset: &Symbol) -> Option<PriceData> {
        let oracle_address: Address = env.storage().instance().get(&DataKey::PrimaryOracle)?;
        external::call_oracle(env, &oracle_address, asset)
    }

    /// Fetch price from secondary oracle (DIA).
    fn fetch_secondary_price(env: &Env, asset: &Symbol) -> Option<PriceData> {
        let oracle_address: Address = env.storage().instance().get(&DataKey::SecondaryOracle)?;
        external::call_oracle(env, &oracle_address, asset)
    }

    /// Check if a price is stale.
    fn is_stale(price_timestamp: u64, current_timestamp: u64, max_age: u64) -> bool {
        if current_timestamp < price_timestamp {
            return false; // Clock skew protection
        }
        current_timestamp - price_timestamp > max_age
    }

    /// Check if two prices deviate too much.
    fn deviation_too_high(price1: i128, price2: i128, max_bps: u32) -> bool {
        if price1 == 0 || price2 == 0 {
            return true; // Zero prices are invalid
        }

        let diff = if price1 > price2 {
            price1 - price2
        } else {
            price2 - price1
        };

        let avg = (price1 + price2) / 2;
        let deviation_bps = diff * (BASIS_POINTS as i128) / avg;

        deviation_bps > (max_bps as i128)
    }

    /// Cache a price result.
    fn cache_price(
        env: &Env,
        asset: &Symbol,
        price: i128,
        timestamp: u64,
        primary_available: bool,
        secondary_available: bool,
    ) {
        let cached = CachedPrice {
            price,
            timestamp,
            primary_available,
            secondary_available,
        };
        env.storage().persistent().set(&DataKey::CachedPrice(asset.clone()), &cached);
        env.storage().persistent().extend_ttl(&DataKey::CachedPrice(asset.clone()), 3600, 3600);
    }

    /// Verify contract is initialized.
    fn require_initialized(env: &Env) -> Result<(), NoetherError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(NoetherError::NotInitialized);
        }
        Ok(())
    }

    /// Verify contract is not paused.
    fn require_not_paused(env: &Env) -> Result<(), NoetherError> {
        if env.storage().instance().get(&DataKey::Paused).unwrap_or(false) {
            return Err(NoetherError::Paused);
        }
        Ok(())
    }

    /// Verify caller is admin.
    fn require_admin(env: &Env) -> Result<(), NoetherError> {
        Self::require_initialized(env)?;
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(NoetherError::NotInitialized)?;
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

    fn setup_env() -> (Env, Address, Address, Address, OracleAdapterContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let band_oracle = Address::generate(&env);
        let dia_oracle = Address::generate(&env);

        let contract_id = env.register_contract(None, OracleAdapterContract);
        let client = OracleAdapterContractClient::new(&env, &contract_id);

        (env, admin, band_oracle, dia_oracle, client)
    }

    #[test]
    fn test_initialize() {
        let (env, admin, band, dia, client) = setup_env();

        client.initialize(&admin, &band, &dia, &60, &100);

        let config = client.get_config();
        assert_eq!(config.primary_oracle, band);
        assert_eq!(config.secondary_oracle, dia);
        assert_eq!(config.max_staleness, 60);
        assert_eq!(config.max_deviation_bps, 100);
    }

    #[test]
    fn test_deviation_check() {
        // Test deviation calculation
        let price1: i128 = 10_000_000; // $1.00
        let price2: i128 = 10_100_000; // $1.01 (1% higher)

        // 1% deviation should not be too high with 100 bps threshold
        assert!(!OracleAdapterContract::deviation_too_high(price1, price2, 100));

        // But should be too high with 50 bps threshold
        assert!(OracleAdapterContract::deviation_too_high(price1, price2, 50));
    }

    #[test]
    fn test_staleness_check() {
        let current = 1000u64;
        let recent = 950u64;
        let old = 900u64;
        let max_age = 60u64;

        assert!(!OracleAdapterContract::is_stale(recent, current, max_age)); // 50s old, OK
        assert!(OracleAdapterContract::is_stale(old, current, max_age));     // 100s old, stale
    }

    #[test]
    fn test_pause_unpause() {
        let (env, admin, band, dia, client) = setup_env();
        client.initialize(&admin, &band, &dia, &60, &100);

        assert!(!client.is_paused());

        client.pause();
        assert!(client.is_paused());

        client.unpause();
        assert!(!client.is_paused());
    }

    #[test]
    fn test_update_config() {
        let (env, admin, band, dia, client) = setup_env();
        client.initialize(&admin, &band, &dia, &60, &100);

        // Update staleness
        client.set_max_staleness(&120);
        let config = client.get_config();
        assert_eq!(config.max_staleness, 120);

        // Update deviation
        client.set_max_deviation(&200);
        let config = client.get_config();
        assert_eq!(config.max_deviation_bps, 200);
    }
}
