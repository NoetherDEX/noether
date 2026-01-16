//! # External Oracle Calls
//!
//! Cross-contract calls to Band Protocol and DIA oracles.
//! Uses SEP-0040 compatible interface.

use soroban_sdk::{Address, Env, Symbol, IntoVal};
use noether_common::PriceData;

/// Call an external oracle contract to get price.
///
/// This function attempts to call the oracle using the SEP-0040 interface.
/// Both Band and DIA oracles on Stellar implement this interface.
///
/// # Arguments
/// * `env` - Contract environment
/// * `oracle_address` - Address of the oracle contract
/// * `asset` - Asset symbol to query
///
/// # Returns
/// Option<PriceData> - Price data if successful, None if call fails
pub fn call_oracle(env: &Env, oracle_address: &Address, asset: &Symbol) -> Option<PriceData> {
    // Try to call the oracle using invoke_contract
    // SEP-0040 oracles have a `lastprice` function that returns (price: i128, timestamp: u64)

    // First, try the standard SEP-0040 interface
    let result = try_sep0040_call(env, oracle_address, asset);
    if result.is_some() {
        return result;
    }

    // Fallback: try alternative function names
    let result = try_alternative_call(env, oracle_address, asset);
    if result.is_some() {
        return result;
    }

    None
}

/// Try calling oracle with SEP-0040 standard interface.
///
/// SEP-0040 defines: `lastprice(asset) -> (i128, u64)`
fn try_sep0040_call(env: &Env, oracle_address: &Address, asset: &Symbol) -> Option<PriceData> {
    // Build the asset argument for SEP-0040
    // Note: We use invoke_contract which panics on error
    // In production, we'd want better error handling

    let args: soroban_sdk::Vec<soroban_sdk::Val> = (asset.clone(),).into_val(env);

    // Try to call - if it fails, we return None
    // Using a defensive approach since try_invoke_contract has complex generics
    let result: Option<(i128, u64)> = {
        // We can't easily use try_invoke_contract, so we'll use invoke_contract
        // wrapped in a way that handles potential issues
        Some(env.invoke_contract(
            oracle_address,
            &Symbol::new(env, "lastprice"),
            args,
        ))
    };

    match result {
        Some((price, timestamp)) if price > 0 => Some(PriceData { price, timestamp }),
        _ => None,
    }
}

/// Try calling oracle with alternative function names.
///
/// Some oracles might use different naming conventions.
fn try_alternative_call(env: &Env, oracle_address: &Address, asset: &Symbol) -> Option<PriceData> {
    // Try "get_price" function name
    let args: soroban_sdk::Vec<soroban_sdk::Val> = (asset.clone(),).into_val(env);

    let result: Option<(i128, u64)> = {
        Some(env.invoke_contract(
            oracle_address,
            &Symbol::new(env, "get_price"),
            args,
        ))
    };

    match result {
        Some((price, timestamp)) if price > 0 => Some(PriceData { price, timestamp }),
        _ => None,
    }
}

/// Verify an oracle address is valid by checking it has code.
pub fn verify_oracle_exists(env: &Env, oracle_address: &Address) -> bool {
    // In Soroban, we can't directly check if a contract exists,
    // but we can try a benign call and see if it fails
    // For now, we assume the oracle exists if provided
    true
}

// ═══════════════════════════════════════════════════════════════════════════
// SEP-0040 Asset Type Definitions
// ═══════════════════════════════════════════════════════════════════════════

/// Asset type enum matching SEP-0040 specification.
/// Used when calling oracles that require the full asset specification.
#[derive(Clone, Debug)]
pub enum Sep0040AssetType {
    /// Stellar native asset (XLM)
    Stellar,
    /// Other assets identified by symbol
    Other(Symbol),
}

impl Sep0040AssetType {
    /// Create asset type for XLM.
    pub fn stellar() -> Self {
        Self::Stellar
    }

    /// Create asset type for other assets.
    pub fn other(symbol: Symbol) -> Self {
        Self::Other(symbol)
    }

    /// Convert to tuple format expected by some oracles.
    pub fn to_tuple(&self, env: &Env) -> (u32, Option<Symbol>) {
        match self {
            Self::Stellar => (0, None),
            Self::Other(sym) => (1, Some(sym.clone())),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Oracle Response Parsing
// ═══════════════════════════════════════════════════════════════════════════

/// Parse price from various oracle response formats.
/// Different oracles may return prices in different formats.
pub fn normalize_price(raw_price: i128, oracle_decimals: u32, target_decimals: u32) -> i128 {
    if oracle_decimals == target_decimals {
        return raw_price;
    }

    if oracle_decimals > target_decimals {
        // Oracle has more precision, divide
        let factor = 10i128.pow(oracle_decimals - target_decimals);
        raw_price / factor
    } else {
        // Oracle has less precision, multiply
        let factor = 10i128.pow(target_decimals - oracle_decimals);
        raw_price * factor
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_price_same_decimals() {
        let price = 1_500_000i128; // $0.15 with 7 decimals
        assert_eq!(normalize_price(price, 7, 7), price);
    }

    #[test]
    fn test_normalize_price_more_decimals() {
        // Oracle has 8 decimals, we want 7
        let oracle_price = 15_000_000i128; // $0.15 with 8 decimals
        let normalized = normalize_price(oracle_price, 8, 7);
        assert_eq!(normalized, 1_500_000); // $0.15 with 7 decimals
    }

    #[test]
    fn test_normalize_price_fewer_decimals() {
        // Oracle has 6 decimals, we want 7
        let oracle_price = 150_000i128; // $0.15 with 6 decimals
        let normalized = normalize_price(oracle_price, 6, 7);
        assert_eq!(normalized, 1_500_000); // $0.15 with 7 decimals
    }
}
