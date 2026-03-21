//! # Position Management
//!
//! Position-related utilities and helpers.
//! Includes cross-margin account equity calculations per Stellar security best practices:
//! - Checked arithmetic to prevent overflow
//! - Atomic equity checks in withdrawal path

use soroban_sdk::{Address, Env, Symbol};
use noether_common::{Direction, Position, CrossMarginInfo, PRECISION, BASIS_POINTS, calculate_pnl};
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
// ═══════════════════════════════════════════════════════════════════════════

/// Calculate unrealized PnL for all cross-margin positions of a trader.
/// Uses checked arithmetic per Stellar security best practices.
pub fn calculate_cross_unrealized_pnl(
    env: &Env,
    trader: &Address,
    get_price: &dyn Fn(&Symbol) -> i128,
) -> i128 {
    let position_ids = get_cross_margin_position_ids(env, trader);
    let mut total_pnl: i128 = 0;

    for i in 0..position_ids.len() {
        let id = position_ids.get(i).unwrap();
        if let Some(position) = get_position(env, id) {
            let current_price = get_price(&position.asset);
            if let Ok(pnl) = calculate_pnl(&position, current_price) {
                total_pnl = total_pnl.checked_add(pnl).unwrap_or(total_pnl);
            }
        }
    }

    total_pnl
}

/// Calculate total accumulated funding for all cross-margin positions.
pub fn calculate_cross_total_funding(env: &Env, trader: &Address) -> i128 {
    let position_ids = get_cross_margin_position_ids(env, trader);
    let mut total_funding: i128 = 0;

    for i in 0..position_ids.len() {
        let id = position_ids.get(i).unwrap();
        if let Some(position) = get_position(env, id) {
            total_funding = total_funding
                .checked_add(position.accumulated_funding)
                .unwrap_or(total_funding);
        }
    }

    total_funding
}

/// Calculate cross-margin account equity.
/// equity = balance + unrealized_pnl - accumulated_funding
pub fn calculate_cross_equity(
    env: &Env,
    trader: &Address,
    get_price: &dyn Fn(&Symbol) -> i128,
) -> i128 {
    let balance = get_cross_margin_balance(env, trader);
    let unrealized_pnl = calculate_cross_unrealized_pnl(env, trader, get_price);
    let total_funding = calculate_cross_total_funding(env, trader);

    balance
        .checked_add(unrealized_pnl).unwrap_or(balance)
        .checked_sub(total_funding).unwrap_or(0)
}

/// Calculate aggregate maintenance margin for all cross positions.
/// total_mm = sum(position_size * maintenance_margin_bps / 10000)
pub fn calculate_cross_maintenance_margin(
    env: &Env,
    trader: &Address,
    maintenance_margin_bps: u32,
) -> i128 {
    let position_ids = get_cross_margin_position_ids(env, trader);
    let mut total_mm: i128 = 0;

    for i in 0..position_ids.len() {
        let id = position_ids.get(i).unwrap();
        if let Some(position) = get_position(env, id) {
            let mm = position.size * (maintenance_margin_bps as i128) / (BASIS_POINTS as i128);
            total_mm = total_mm.checked_add(mm).unwrap_or(total_mm);
        }
    }

    total_mm
}

/// Calculate total initial margin used (sum of collateral allocated from pool).
/// For cross-margin, this is sum(size / leverage) for each position.
pub fn calculate_cross_used_margin(env: &Env, trader: &Address) -> i128 {
    let position_ids = get_cross_margin_position_ids(env, trader);
    let mut total: i128 = 0;

    for i in 0..position_ids.len() {
        let id = position_ids.get(i).unwrap();
        if let Some(position) = get_position(env, id) {
            // Initial margin = size / leverage (what was deducted from pool)
            let im = position.size / (position.leverage as i128);
            total = total.checked_add(im).unwrap_or(total);
        }
    }

    total
}

/// Check if a cross-margin account should be liquidated.
/// Liquidatable when: equity < aggregate_maintenance_margin
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

    let equity = calculate_cross_equity(env, trader, get_price);
    let maintenance_margin = calculate_cross_maintenance_margin(env, trader, maintenance_margin_bps);

    equity < maintenance_margin
}

/// Build a CrossMarginInfo view object for a trader.
pub fn build_cross_margin_info(
    env: &Env,
    trader: &Address,
    get_price: &dyn Fn(&Symbol) -> i128,
) -> CrossMarginInfo {
    let balance = get_cross_margin_balance(env, trader);
    let equity = calculate_cross_equity(env, trader, get_price);
    let used_margin = calculate_cross_used_margin(env, trader);
    let free_margin = if equity > used_margin { equity - used_margin } else { 0 };
    let position_ids = get_cross_margin_position_ids(env, trader);

    let margin_ratio_bps = if used_margin > 0 {
        equity * (BASIS_POINTS as i128) / used_margin
    } else {
        (BASIS_POINTS as i128) * 100 // 1000% = no positions
    };

    CrossMarginInfo {
        balance,
        equity,
        used_margin,
        free_margin,
        margin_ratio_bps,
        position_count: position_ids.len(),
    }
}

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
