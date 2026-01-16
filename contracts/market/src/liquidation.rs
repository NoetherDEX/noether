//! # Liquidation Logic
//!
//! Liquidation calculations and helpers.

use noether_common::{Position, Direction, BASIS_POINTS};

/// Calculate liquidation threshold.
/// Position should be liquidated when margin falls below this.
pub fn calculate_liquidation_threshold(size: i128, maintenance_margin_bps: u32) -> i128 {
    size * (maintenance_margin_bps as i128) / (BASIS_POINTS as i128)
}

/// Calculate the current margin of a position.
pub fn calculate_current_margin(position: &Position, current_price: i128) -> i128 {
    let pnl = match position.direction {
        Direction::Long => {
            position.size * (current_price - position.entry_price) / position.entry_price
        }
        Direction::Short => {
            position.size * (position.entry_price - current_price) / position.entry_price
        }
    };

    position.collateral + pnl - position.accumulated_funding
}

/// Calculate margin ratio for liquidation check.
/// Returns margin as percentage of position size in basis points.
pub fn calculate_margin_ratio_bps(position: &Position, current_price: i128) -> i128 {
    let current_margin = calculate_current_margin(position, current_price);
    if position.size == 0 {
        return BASIS_POINTS as i128;
    }
    current_margin * (BASIS_POINTS as i128) / position.size
}

/// Check if a position should be liquidated.
/// Simpler check: just compare price to liquidation price.
pub fn check_liquidation(position: &Position, current_price: i128) -> bool {
    match position.direction {
        Direction::Long => current_price <= position.liquidation_price,
        Direction::Short => current_price >= position.liquidation_price,
    }
}

/// Calculate liquidation proceeds distribution.
/// Returns (to_vault, to_keeper, bad_debt)
pub fn calculate_liquidation_distribution(
    position: &Position,
    current_price: i128,
    liquidation_fee_bps: u32,
) -> (i128, i128, i128) {
    let pnl = match position.direction {
        Direction::Long => {
            position.size * (current_price - position.entry_price) / position.entry_price
        }
        Direction::Short => {
            position.size * (position.entry_price - current_price) / position.entry_price
        }
    };

    let remaining = position.collateral + pnl - position.accumulated_funding;

    if remaining <= 0 {
        // Bad debt scenario - position lost more than collateral
        return (0, 0, -remaining);
    }

    // Calculate keeper reward
    let keeper_reward = remaining * (liquidation_fee_bps as i128) / (BASIS_POINTS as i128);

    // Remaining goes to vault
    let to_vault = remaining - keeper_reward;

    (to_vault, keeper_reward, 0)
}

/// Calculate safe price distance from liquidation.
/// Returns the price change needed to trigger liquidation.
pub fn calculate_distance_to_liquidation(position: &Position, current_price: i128) -> i128 {
    let distance = match position.direction {
        Direction::Long => current_price - position.liquidation_price,
        Direction::Short => position.liquidation_price - current_price,
    };

    if distance < 0 {
        0 // Already liquidatable
    } else {
        distance
    }
}

/// Calculate distance to liquidation as percentage.
pub fn calculate_distance_to_liquidation_pct(position: &Position, current_price: i128) -> i128 {
    let distance = calculate_distance_to_liquidation(position, current_price);
    distance * (BASIS_POINTS as i128) / current_price
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{Env, Address, Symbol};

    fn create_long_position(env: &Env) -> Position {
        Position {
            id: 1,
            trader: Address::generate(env),
            asset: Symbol::new(env, "XLM"),
            collateral: 100 * PRECISION,
            size: 1000 * PRECISION,
            entry_price: PRECISION, // $1.00
            direction: Direction::Long,
            leverage: 10,
            liquidation_price: PRECISION * 91 / 100, // $0.91
            timestamp: 1000000,
            last_funding_time: 1000000,
            accumulated_funding: 0,
        }
    }

    #[test]
    fn test_check_liquidation_long() {
        let env = Env::default();
        let position = create_long_position(&env);

        // Price above liquidation - should not liquidate
        assert!(!check_liquidation(&position, PRECISION * 95 / 100));

        // Price at liquidation - should liquidate
        assert!(check_liquidation(&position, PRECISION * 91 / 100));

        // Price below liquidation - should liquidate
        assert!(check_liquidation(&position, PRECISION * 85 / 100));
    }

    #[test]
    fn test_current_margin() {
        let env = Env::default();
        let position = create_long_position(&env);

        // No price change
        let margin = calculate_current_margin(&position, PRECISION);
        assert_eq!(margin, 100 * PRECISION);

        // 5% gain
        let margin = calculate_current_margin(&position, PRECISION * 105 / 100);
        assert_eq!(margin, 150 * PRECISION); // 100 + 50 profit

        // 5% loss
        let margin = calculate_current_margin(&position, PRECISION * 95 / 100);
        assert_eq!(margin, 50 * PRECISION); // 100 - 50 loss
    }

    #[test]
    fn test_liquidation_distribution() {
        let env = Env::default();
        let position = create_long_position(&env);

        // 8% loss (position still has value)
        let (to_vault, to_keeper, bad_debt) = calculate_liquidation_distribution(
            &position,
            PRECISION * 92 / 100,
            500, // 5% keeper fee
        );

        // 8% loss on $1000 = $80 loss
        // Remaining = $100 - $80 = $20
        // Keeper gets 5% of $20 = $1
        // Vault gets $19

        assert!(to_vault > 0);
        assert!(to_keeper > 0);
        assert_eq!(bad_debt, 0);
    }

    #[test]
    fn test_bad_debt() {
        let env = Env::default();
        let mut position = create_long_position(&env);
        position.liquidation_price = PRECISION * 50 / 100; // Lower liq price for test

        // 15% loss
        let (to_vault, to_keeper, bad_debt) = calculate_liquidation_distribution(
            &position,
            PRECISION * 85 / 100,
            500,
        );

        // 15% loss on $1000 = $150 loss
        // Remaining = $100 - $150 = -$50 (bad debt)
        assert_eq!(to_vault, 0);
        assert_eq!(to_keeper, 0);
        assert!(bad_debt > 0);
    }
}
