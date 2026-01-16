//! # Position Management
//!
//! Position-related utilities and helpers.

use soroban_sdk::{Address, Env};
use noether_common::Direction;
use crate::storage::{get_position, get_all_position_ids};

/// Check if an address has any open positions.
pub fn has_open_positions(env: &Env, trader: &Address) -> bool {
    let positions = crate::storage::get_trader_positions(env, trader);
    !positions.is_empty()
}

/// Get total position value for a trader.
pub fn get_trader_total_value(env: &Env, trader: &Address) -> i128 {
    let positions = crate::storage::get_trader_positions(env, trader);
    let mut total = 0i128;

    for i in 0..positions.len() {
        let pos = positions.get(i).unwrap();
        total += pos.size;
    }

    total
}

/// Get total collateral for a trader.
pub fn get_trader_total_collateral(env: &Env, trader: &Address) -> i128 {
    let positions = crate::storage::get_trader_positions(env, trader);
    let mut total = 0i128;

    for i in 0..positions.len() {
        let pos = positions.get(i).unwrap();
        total += pos.collateral;
    }

    total
}

/// Calculate total unrealized PnL for all positions.
/// This is used by the vault to track its liabilities.
pub fn calculate_total_unrealized_pnl(
    env: &Env,
    get_price: impl Fn(&Env, &soroban_sdk::Symbol) -> Option<i128>,
) -> i128 {
    let position_ids = get_all_position_ids(env);
    let mut total_pnl = 0i128;

    for i in 0..position_ids.len() {
        let id = position_ids.get(i).unwrap();
        if let Some(position) = get_position(env, id) {
            if let Some(current_price) = get_price(env, &position.asset) {
                let pnl = match position.direction {
                    Direction::Long => {
                        position.size * (current_price - position.entry_price) / position.entry_price
                    }
                    Direction::Short => {
                        position.size * (position.entry_price - current_price) / position.entry_price
                    }
                };
                total_pnl += pnl;
            }
        }
    }

    total_pnl
}

/// Validate position parameters.
pub fn validate_position_params(
    collateral: i128,
    leverage: u32,
    min_collateral: i128,
    max_leverage: u32,
    max_position_size: i128,
) -> Result<(), &'static str> {
    if collateral < min_collateral {
        return Err("Collateral below minimum");
    }

    if leverage < 1 || leverage > max_leverage {
        return Err("Invalid leverage");
    }

    let size = collateral * (leverage as i128);
    if size > max_position_size {
        return Err("Position too large");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_params_valid() {
        let result = validate_position_params(
            100 * PRECISION, // 100 USDC
            5,               // 5x leverage
            10 * PRECISION,  // 10 USDC min
            10,              // 10x max
            100_000 * PRECISION, // 100k max size
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_params_low_collateral() {
        let result = validate_position_params(
            5 * PRECISION,   // 5 USDC (below minimum)
            5,
            10 * PRECISION,
            10,
            100_000 * PRECISION,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_params_high_leverage() {
        let result = validate_position_params(
            100 * PRECISION,
            15,              // 15x (above maximum)
            10 * PRECISION,
            10,
            100_000 * PRECISION,
        );
        assert!(result.is_err());
    }
}
