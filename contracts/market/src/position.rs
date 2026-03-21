//! # Position Management
//!
//! Position-related utilities and helpers.
//! Includes cross-margin account equity calculations per Stellar security best practices:
//! - Checked arithmetic to prevent overflow
//! - Atomic equity checks in withdrawal path

use soroban_sdk::{Address, Env, Symbol};
use noether_common::{Direction, BASIS_POINTS, calculate_pnl};
use crate::storage::{
    get_position, get_all_position_ids,
    get_cross_margin_balance, get_cross_margin_position_ids,
};

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

// ═══════════════════════════════════════════════════════════════════════════
// Cross-Margin Account Calculations
// Single-pass iteration for WASM size efficiency (Stellar best practice)
// ═══════════════════════════════════════════════════════════════════════════

/// Aggregated cross-margin account state from single position iteration.
struct CrossAggregates {
    unrealized_pnl: i128,
    total_funding: i128,
    maintenance_margin: i128,
    used_margin: i128,
    count: u32,
}

/// Calculate all cross-margin aggregates in a single pass over positions.
fn aggregate_cross_positions(
    env: &Env,
    trader: &Address,
    maintenance_margin_bps: u32,
    get_price: &dyn Fn(&Symbol) -> i128,
) -> CrossAggregates {
    let position_ids = get_cross_margin_position_ids(env, trader);
    let mut agg = CrossAggregates {
        unrealized_pnl: 0,
        total_funding: 0,
        maintenance_margin: 0,
        used_margin: 0,
        count: position_ids.len(),
    };

    for i in 0..position_ids.len() {
        let id = position_ids.get(i).unwrap();
        if let Some(pos) = get_position(env, id) {
            // PnL
            let price = get_price(&pos.asset);
            if let Ok(pnl) = calculate_pnl(&pos, price) {
                agg.unrealized_pnl = agg.unrealized_pnl.checked_add(pnl).unwrap_or(agg.unrealized_pnl);
            }
            // Funding
            agg.total_funding = agg.total_funding.checked_add(pos.accumulated_funding).unwrap_or(agg.total_funding);
            // Maintenance margin
            let mm = pos.size * (maintenance_margin_bps as i128) / (BASIS_POINTS as i128);
            agg.maintenance_margin = agg.maintenance_margin.checked_add(mm).unwrap_or(agg.maintenance_margin);
            // Used margin (initial margin = size / leverage)
            let im = pos.size / (pos.leverage as i128);
            agg.used_margin = agg.used_margin.checked_add(im).unwrap_or(agg.used_margin);
        }
    }

    agg
}

/// Calculate cross-margin account equity.
pub fn calculate_cross_equity(
    env: &Env,
    trader: &Address,
    get_price: &dyn Fn(&Symbol) -> i128,
) -> i128 {
    let balance = get_cross_margin_balance(env, trader);
    let agg = aggregate_cross_positions(env, trader, 0, get_price);
    balance.checked_add(agg.unrealized_pnl).unwrap_or(balance)
           .checked_sub(agg.total_funding).unwrap_or(0)
}

/// Calculate aggregate maintenance margin for all cross positions.
pub fn calculate_cross_maintenance_margin(
    env: &Env,
    trader: &Address,
    maintenance_margin_bps: u32,
) -> i128 {
    let no_price = |_: &Symbol| -> i128 { 0 };
    let agg = aggregate_cross_positions(env, trader, maintenance_margin_bps, &no_price);
    agg.maintenance_margin
}

/// Check if a cross-margin account should be liquidated.
pub fn is_cross_account_liquidatable(
    env: &Env,
    trader: &Address,
    maintenance_margin_bps: u32,
    get_price: &dyn Fn(&Symbol) -> i128,
) -> bool {
    let position_ids = get_cross_margin_position_ids(env, trader);
    if position_ids.is_empty() {
        return false;
    }

    let balance = get_cross_margin_balance(env, trader);
    let agg = aggregate_cross_positions(env, trader, maintenance_margin_bps, get_price);
    let equity = balance.checked_add(agg.unrealized_pnl).unwrap_or(balance)
                        .checked_sub(agg.total_funding).unwrap_or(0);
    equity < agg.maintenance_margin
}

// build_cross_margin_info removed for WASM size - frontend computes client-side

#[cfg(test)]
mod tests {
    use super::*;
    use noether_common::PRECISION;

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
