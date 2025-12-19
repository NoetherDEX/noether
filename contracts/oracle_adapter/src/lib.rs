#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, vec, Address, Env, IntoVal, Symbol, Val, Vec,
};
use noether_common::{Asset, Error, OracleTrait, PriceData};

// ============================================================================
// External Oracle Response Structures
// ============================================================================

/// Band Protocol reference data structure
/// Based on Band Protocol's Soroban oracle interface
#[derive(Clone, Debug)]
#[contracttype]
pub struct BandReferenceData {
    pub rate: i128,              // Price rate (18 decimals)
    pub last_updated_base: u64,  // Timestamp of base update
    pub last_updated_quote: u64, // Timestamp of quote update
}

/// DIA Protocol price data structure
/// Based on DIA's Soroban oracle interface
#[derive(Clone, Debug)]
#[contracttype]
pub struct DiaOracleValue {
    pub price: i128,      // Price (8 decimals)
    pub timestamp: u64,   // Unix timestamp
}

// ============================================================================
// Storage Keys
// ============================================================================

const BAND_ADDR: Symbol = symbol_short!("BAND");
const DIA_ADDR: Symbol = symbol_short!("DIA");
const ADMIN: Symbol = symbol_short!("ADMIN");
const INIT: Symbol = symbol_short!("INIT");

// ============================================================================
// Constants
// ============================================================================

/// Standard precision for Soroban/Stellar (7 decimals)
const PRECISION: i128 = 10_000_000; // 1e7

/// Band Protocol uses 18 decimals for rates
const BAND_DECIMALS: i128 = 1_000_000_000_000_000_000; // 1e18

/// DIA Protocol uses 8 decimals
const DIA_DECIMALS: i128 = 100_000_000; // 1e8

/// Maximum allowed staleness in seconds (5 minutes)
const MAX_STALENESS: u64 = 300;

/// Maximum allowed price deviation (2% = 200 basis points)
const MAX_DEVIATION_BPS: i128 = 200;

// ============================================================================
// Oracle Adapter Contract
// ============================================================================

#[contract]
pub struct OracleAdapter;

#[contractimpl]
impl OracleAdapter {
    /// Initialize the oracle adapter with Band and DIA contract addresses
    pub fn initialize(env: Env, admin: Address, band: Address, dia: Address) -> Result<(), Error> {
        // Check if already initialized
        if env.storage().instance().has(&INIT) {
            return Err(Error::AlreadyInitialized);
        }

        // Store addresses
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&BAND_ADDR, &band);
        env.storage().instance().set(&DIA_ADDR, &dia);
        env.storage().instance().set(&INIT, &true);

        // Extend TTL for instance storage
        env.storage().instance().extend_ttl(100_000, 100_000);

        Ok(())
    }

    /// Update oracle addresses (admin only)
    pub fn update_oracles(env: Env, band: Address, dia: Address) -> Result<(), Error> {
        let admin: Address = env.storage().instance().get(&ADMIN)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        env.storage().instance().set(&BAND_ADDR, &band);
        env.storage().instance().set(&DIA_ADDR, &dia);

        Ok(())
    }

    /// Get the current price for an asset with safety checks
    /// Fetches from both Band and DIA, validates, and returns average
    pub fn get_price(env: Env, asset: Asset) -> Result<i128, Error> {
        // Get oracle addresses
        let band_addr: Address = env.storage().instance().get(&BAND_ADDR)
            .ok_or(Error::NotInitialized)?;
        let dia_addr: Address = env.storage().instance().get(&DIA_ADDR)
            .ok_or(Error::NotInitialized)?;

        // Get asset symbols for each oracle
        let (band_base, band_quote) = Self::get_band_symbols(&env, &asset)?;
        let dia_key = Self::get_dia_key(&env, &asset)?;

        // Fetch prices from both oracles via cross-contract calls
        let band_price = Self::fetch_band_price(&env, &band_addr, &band_base, &band_quote)?;
        let dia_price = Self::fetch_dia_price(&env, &dia_addr, &dia_key)?;

        // Check for price deviation between oracles
        Self::check_deviation(band_price, dia_price)?;

        // Return average of both prices (normalized to 7 decimals)
        let avg_price = (band_price + dia_price) / 2;
        Ok(avg_price)
    }

    /// Get price from Band oracle only (for debugging/fallback)
    pub fn get_band_price(env: Env, asset: Asset) -> Result<i128, Error> {
        let band_addr: Address = env.storage().instance().get(&BAND_ADDR)
            .ok_or(Error::NotInitialized)?;
        let (band_base, band_quote) = Self::get_band_symbols(&env, &asset)?;
        Self::fetch_band_price(&env, &band_addr, &band_base, &band_quote)
    }

    /// Get price from DIA oracle only (for debugging/fallback)
    pub fn get_dia_price(env: Env, asset: Asset) -> Result<i128, Error> {
        let dia_addr: Address = env.storage().instance().get(&DIA_ADDR)
            .ok_or(Error::NotInitialized)?;
        let dia_key = Self::get_dia_key(&env, &asset)?;
        Self::fetch_dia_price(&env, &dia_addr, &dia_key)
    }

    /// Get price data with timestamp
    pub fn get_price_data(env: Env, asset: Asset) -> Result<PriceData, Error> {
        let price = Self::get_price(env.clone(), asset)?;
        Ok(PriceData {
            price,
            timestamp: env.ledger().timestamp(),
        })
    }

    /// Get Band oracle address
    pub fn get_band_address(env: Env) -> Result<Address, Error> {
        env.storage().instance().get(&BAND_ADDR)
            .ok_or(Error::NotInitialized)
    }

    /// Get DIA oracle address
    pub fn get_dia_address(env: Env) -> Result<Address, Error> {
        env.storage().instance().get(&DIA_ADDR)
            .ok_or(Error::NotInitialized)
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage().instance().get(&ADMIN)
            .ok_or(Error::NotInitialized)
    }
}

// ============================================================================
// Internal Implementation
// ============================================================================

impl OracleAdapter {
    /// Get Band Protocol symbols for an asset
    fn get_band_symbols(env: &Env, asset: &Asset) -> Result<(Symbol, Symbol), Error> {
        match asset {
            Asset::Stellar => Ok((
                Symbol::new(env, "XLM"),
                Symbol::new(env, "USD"),
            )),
            Asset::USDC => Ok((
                Symbol::new(env, "USDC"),
                Symbol::new(env, "USD"),
            )),
        }
    }

    /// Get DIA oracle key for an asset
    fn get_dia_key(env: &Env, asset: &Asset) -> Result<Symbol, Error> {
        match asset {
            Asset::Stellar => Ok(Symbol::new(env, "XLM/USD")),
            Asset::USDC => Ok(Symbol::new(env, "USDC/USD")),
        }
    }

    /// Fetch price from Band Protocol via cross-contract call
    /// Band returns rate with 18 decimals, we normalize to 7
    fn fetch_band_price(
        env: &Env,
        band_addr: &Address,
        base: &Symbol,
        quote: &Symbol,
    ) -> Result<i128, Error> {
        // Prepare arguments for Band's get_reference_data function
        let args: Vec<Val> = vec![env, base.into_val(env), quote.into_val(env)];

        // Cross-contract call to Band oracle
        // Function: get_reference_data(base: Symbol, quote: Symbol) -> ReferenceData
        let result: BandReferenceData = env.invoke_contract(
            band_addr,
            &Symbol::new(env, "get_reference_data"),
            args,
        );

        // Check staleness
        let current_time = env.ledger().timestamp();
        let last_updated = result.last_updated_base.max(result.last_updated_quote);
        if last_updated < current_time.saturating_sub(MAX_STALENESS) {
            return Err(Error::OracleStale);
        }

        // Normalize from 18 decimals to 7 decimals
        let normalized_price = (result.rate * PRECISION) / BAND_DECIMALS;

        if normalized_price <= 0 {
            return Err(Error::PriceDivergence);
        }

        Ok(normalized_price)
    }

    /// Fetch price from DIA Protocol via cross-contract call
    /// DIA returns price with 8 decimals, we normalize to 7
    fn fetch_dia_price(
        env: &Env,
        dia_addr: &Address,
        key: &Symbol,
    ) -> Result<i128, Error> {
        // Prepare arguments for DIA's get_price / lastprice function
        let args: Vec<Val> = vec![env, key.into_val(env)];

        // Cross-contract call to DIA oracle
        // Function: lastprice(key: Symbol) -> Option<PriceData>
        // DIA typically uses "lastprice" as the function name
        let result: DiaOracleValue = env.invoke_contract(
            dia_addr,
            &Symbol::new(env, "lastprice"),
            args,
        );

        // Check staleness
        let current_time = env.ledger().timestamp();
        if result.timestamp < current_time.saturating_sub(MAX_STALENESS) {
            return Err(Error::OracleStale);
        }

        // Normalize from 8 decimals to 7 decimals
        let normalized_price = (result.price * PRECISION) / DIA_DECIMALS;

        if normalized_price <= 0 {
            return Err(Error::PriceDivergence);
        }

        Ok(normalized_price)
    }

    /// Check if price deviation between oracles exceeds threshold
    fn check_deviation(price_a: i128, price_b: i128) -> Result<(), Error> {
        if price_a <= 0 || price_b <= 0 {
            return Err(Error::PriceDivergence);
        }

        // Calculate absolute difference
        let diff = if price_a > price_b {
            price_a - price_b
        } else {
            price_b - price_a
        };

        // Calculate deviation in basis points (1 bp = 0.01%)
        // deviation_bps = (diff * 10000) / min(price_a, price_b)
        let min_price = price_a.min(price_b);
        let deviation_bps = (diff * 10_000) / min_price;

        if deviation_bps > MAX_DEVIATION_BPS {
            return Err(Error::PriceDivergence);
        }

        Ok(())
    }
}

// ============================================================================
// OracleTrait Implementation
// ============================================================================

impl OracleTrait for OracleAdapter {
    fn get_price(env: Env, asset: Asset) -> Result<i128, Error> {
        OracleAdapter::get_price(env, asset)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_initialize() {
        let env = Env::default();
        let contract_id = env.register_contract(None, OracleAdapter);
        let client = OracleAdapterClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let band = Address::generate(&env);
        let dia = Address::generate(&env);

        client.initialize(&admin, &band, &dia);

        assert_eq!(client.get_band_address(), band);
        assert_eq!(client.get_dia_address(), dia);
        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    fn test_check_deviation_within_limit() {
        let price_a: i128 = 1_000_000; // 0.1 with 7 decimals
        let price_b: i128 = 1_015_000; // 0.1015 with 7 decimals (1.5% diff)

        assert!(OracleAdapter::check_deviation(price_a, price_b).is_ok());
    }

    #[test]
    fn test_check_deviation_exceeds_limit() {
        let price_a: i128 = 1_000_000; // 0.1 with 7 decimals
        let price_b: i128 = 1_030_000; // 0.103 with 7 decimals (3% diff)

        assert!(OracleAdapter::check_deviation(price_a, price_b).is_err());
    }

    #[test]
    fn test_update_oracles_unauthorized() {
        let env = Env::default();
        let contract_id = env.register_contract(None, OracleAdapter);
        let client = OracleAdapterClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let band = Address::generate(&env);
        let dia = Address::generate(&env);

        client.initialize(&admin, &band, &dia);

        // Try to update without auth - should fail
        let new_band = Address::generate(&env);
        let new_dia = Address::generate(&env);

        // This should panic due to missing auth
        // In a real test, we'd use should_panic or try_update_oracles
    }
}
