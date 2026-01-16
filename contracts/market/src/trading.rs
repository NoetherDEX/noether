//! # Trading Logic
//!
//! Core trading calculations and validations.

use noether_common::{Direction, Position, PRECISION, BASIS_POINTS};

/// Calculate the effective leverage of a position given current collateral.
pub fn calculate_effective_leverage(size: i128, collateral: i128) -> u32 {
    if collateral <= 0 {
        return 0;
    }
    ((size / collateral) as u32).max(1)
}

/// Calculate margin ratio (collateral / size).
/// A lower margin ratio means higher risk.
pub fn calculate_margin_ratio(collateral: i128, size: i128) -> i128 {
    if size <= 0 {
        return PRECISION; // 100% margin if no size
    }
    collateral * PRECISION / size
}

/// Calculate the maximum loss possible for a position.
/// For longs: max_loss = entry_price (price goes to 0)
/// For shorts: max_loss = unlimited (capped at position size for practical purposes)
pub fn calculate_max_loss(position: &Position) -> i128 {
    match position.direction {
        Direction::Long => {
            // Price can go to 0, losing entire position
            position.collateral
        }
        Direction::Short => {
            // Price can go to infinity, but we cap at 10x the entry
            // This is a practical maximum for risk calculation
            position.size * 10
        }
    }
}

/// Check if a position has sufficient margin.
pub fn has_sufficient_margin(
    collateral: i128,
    size: i128,
    maintenance_margin_bps: u32,
) -> bool {
    let required_margin = size * (maintenance_margin_bps as i128) / (BASIS_POINTS as i128);
    collateral >= required_margin
}

/// Calculate the break-even price for a position.
/// This is the price at which PnL = 0.
pub fn calculate_break_even_price(position: &Position, total_fees_paid: i128) -> i128 {
    // Break-even needs to cover fees
    let fee_impact = total_fees_paid * position.entry_price / position.size;

    match position.direction {
        Direction::Long => position.entry_price + fee_impact,
        Direction::Short => position.entry_price - fee_impact,
    }
}

/// Calculate partial close amounts.
/// Returns (close_collateral, close_size, remaining_collateral, remaining_size)
pub fn calculate_partial_close(
    position: &Position,
    close_percentage_bps: u32,
) -> (i128, i128, i128, i128) {
    let close_size = position.size * (close_percentage_bps as i128) / (BASIS_POINTS as i128);
    let close_collateral = position.collateral * (close_percentage_bps as i128) / (BASIS_POINTS as i128);

    let remaining_size = position.size - close_size;
    let remaining_collateral = position.collateral - close_collateral;

    (close_collateral, close_size, remaining_collateral, remaining_size)
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{Env, Address, Symbol};

    fn create_test_position(env: &Env) -> Position {
        Position {
            id: 1,
            trader: Address::generate(env),
            asset: Symbol::new(env, "XLM"),
            collateral: 100 * PRECISION,
            size: 1000 * PRECISION,
            entry_price: PRECISION,
            direction: Direction::Long,
            leverage: 10,
            liquidation_price: PRECISION * 91 / 100,
            timestamp: 1000000,
            last_funding_time: 1000000,
            accumulated_funding: 0,
        }
    }

    #[test]
    fn test_effective_leverage() {
        let leverage = calculate_effective_leverage(1000 * PRECISION, 100 * PRECISION);
        assert_eq!(leverage, 10);
    }

    #[test]
    fn test_margin_ratio() {
        let ratio = calculate_margin_ratio(100 * PRECISION, 1000 * PRECISION);
        assert_eq!(ratio, PRECISION / 10); // 10% margin
    }

    #[test]
    fn test_sufficient_margin() {
        // 10% margin, 1% maintenance
        assert!(has_sufficient_margin(100 * PRECISION, 1000 * PRECISION, 100));

        // 0.5% margin, 1% maintenance
        assert!(!has_sufficient_margin(5 * PRECISION, 1000 * PRECISION, 100));
    }

    #[test]
    fn test_partial_close() {
        let env = Env::default();
        let position = create_test_position(&env);

        // Close 50%
        let (close_coll, close_size, rem_coll, rem_size) = calculate_partial_close(&position, 5000);

        assert_eq!(close_coll, 50 * PRECISION);
        assert_eq!(close_size, 500 * PRECISION);
        assert_eq!(rem_coll, 50 * PRECISION);
        assert_eq!(rem_size, 500 * PRECISION);
    }
}
