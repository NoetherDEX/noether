//! # Math Utilities
//!
//! Financial calculations for the Noether protocol.
//! All calculations use 7 decimal precision (PRECISION = 10^7).

use crate::types::{Direction, Position, PRECISION, BASIS_POINTS};
use crate::errors::NoetherError;

/// Calculate position size from collateral and leverage.
///
/// # Formula
/// size = collateral × leverage
///
/// # Arguments
/// * `collateral` - USDC collateral amount (7 decimals)
/// * `leverage` - Leverage multiplier (1-10)
///
/// # Returns
/// Position size in USD value (7 decimals)
pub fn calculate_position_size(collateral: i128, leverage: u32) -> i128 {
    collateral * (leverage as i128)
}

/// Calculate liquidation price for a position.
///
/// # Formula
/// For Long:  liq_price = entry_price × (1 - 1/leverage + maintenance_margin)
/// For Short: liq_price = entry_price × (1 + 1/leverage - maintenance_margin)
///
/// # Arguments
/// * `entry_price` - Price when position was opened (7 decimals)
/// * `leverage` - Leverage multiplier (1-10)
/// * `direction` - Long or Short
/// * `maintenance_margin_bps` - Maintenance margin in basis points
///
/// # Returns
/// Liquidation price (7 decimals)
pub fn calculate_liquidation_price(
    entry_price: i128,
    leverage: u32,
    direction: Direction,
    maintenance_margin_bps: u32,
) -> i128 {
    // Calculate 1/leverage as a fraction of PRECISION
    let leverage_factor = PRECISION / (leverage as i128);

    // Calculate maintenance margin as a fraction of PRECISION
    let margin_factor = (maintenance_margin_bps as i128) * PRECISION / (BASIS_POINTS as i128);

    match direction {
        Direction::Long => {
            // For longs: liq = entry × (1 - 1/leverage + margin)
            // Liquidate when price drops enough that losses exceed margin
            let adjustment = leverage_factor - margin_factor;
            entry_price - (entry_price * adjustment / PRECISION)
        }
        Direction::Short => {
            // For shorts: liq = entry × (1 + 1/leverage - margin)
            // Liquidate when price rises enough that losses exceed margin
            let adjustment = leverage_factor - margin_factor;
            entry_price + (entry_price * adjustment / PRECISION)
        }
    }
}

/// Calculate profit/loss for a position.
///
/// # Formula
/// For Long:  PnL = size × (current_price - entry_price) / entry_price
/// For Short: PnL = size × (entry_price - current_price) / entry_price
///
/// # Arguments
/// * `position` - The position to calculate PnL for
/// * `current_price` - Current market price (7 decimals)
///
/// # Returns
/// PnL in USD value (7 decimals), positive = profit, negative = loss
pub fn calculate_pnl(position: &Position, current_price: i128) -> Result<i128, NoetherError> {
    if position.entry_price == 0 {
        return Err(NoetherError::DivisionByZero);
    }

    let pnl = match position.direction {
        Direction::Long => {
            // Long profits when price goes up
            position.size * (current_price - position.entry_price) / position.entry_price
        }
        Direction::Short => {
            // Short profits when price goes down
            position.size * (position.entry_price - current_price) / position.entry_price
        }
    };

    Ok(pnl)
}

/// Calculate the net value of a position (collateral + unrealized PnL).
///
/// # Arguments
/// * `position` - The position
/// * `current_price` - Current market price (7 decimals)
///
/// # Returns
/// Net value in USDC (7 decimals), can be negative if deeply underwater
pub fn calculate_position_value(
    position: &Position,
    current_price: i128,
) -> Result<i128, NoetherError> {
    let pnl = calculate_pnl(position, current_price)?;
    let value = position.collateral + pnl - position.accumulated_funding;
    Ok(value)
}

/// Check if a position should be liquidated.
///
/// # Arguments
/// * `position` - The position to check
/// * `current_price` - Current market price (7 decimals)
///
/// # Returns
/// true if position should be liquidated
pub fn should_liquidate(position: &Position, current_price: i128) -> bool {
    match position.direction {
        Direction::Long => current_price <= position.liquidation_price,
        Direction::Short => current_price >= position.liquidation_price,
    }
}

/// Calculate keeper reward for liquidation.
///
/// # Arguments
/// * `remaining_collateral` - Collateral left after PnL (7 decimals)
/// * `liquidation_fee_bps` - Liquidation fee in basis points
///
/// # Returns
/// Keeper reward amount (7 decimals)
pub fn calculate_keeper_reward(remaining_collateral: i128, liquidation_fee_bps: u32) -> i128 {
    if remaining_collateral <= 0 {
        return 0;
    }
    remaining_collateral * (liquidation_fee_bps as i128) / (BASIS_POINTS as i128)
}

/// Calculate funding rate based on long/short imbalance.
///
/// # Formula
/// If longs > shorts: funding_rate = base_rate × (longs - shorts) / longs
/// If shorts > longs: funding_rate = -base_rate × (shorts - longs) / shorts
///
/// Positive rate = longs pay shorts
/// Negative rate = shorts pay longs
///
/// # Arguments
/// * `total_long_size` - Total size of all long positions (7 decimals)
/// * `total_short_size` - Total size of all short positions (7 decimals)
/// * `base_rate_bps` - Base funding rate in basis points per hour
///
/// # Returns
/// Funding rate in basis points (can be negative)
pub fn calculate_funding_rate(
    total_long_size: i128,
    total_short_size: i128,
    base_rate_bps: u32,
) -> i128 {
    // If both sides are zero or equal, no funding
    if total_long_size == 0 && total_short_size == 0 {
        return 0;
    }

    if total_long_size == total_short_size {
        return 0;
    }

    let base_rate = base_rate_bps as i128;

    if total_long_size > total_short_size {
        // More longs than shorts - longs pay shorts
        if total_long_size == 0 {
            return 0;
        }
        let imbalance = (total_long_size - total_short_size) * (BASIS_POINTS as i128) / total_long_size;
        base_rate * imbalance / (BASIS_POINTS as i128)
    } else {
        // More shorts than longs - shorts pay longs
        if total_short_size == 0 {
            return 0;
        }
        let imbalance = (total_short_size - total_long_size) * (BASIS_POINTS as i128) / total_short_size;
        -(base_rate * imbalance / (BASIS_POINTS as i128))
    }
}

/// Apply funding to a position.
///
/// # Arguments
/// * `position_size` - Size of the position (7 decimals)
/// * `funding_rate` - Current funding rate in basis points
/// * `direction` - Position direction
/// * `hours_elapsed` - Number of hours since last funding
///
/// # Returns
/// Funding amount to pay (positive) or receive (negative)
pub fn calculate_funding_payment(
    position_size: i128,
    funding_rate: i128,
    direction: Direction,
    hours_elapsed: u64,
) -> i128 {
    if hours_elapsed == 0 {
        return 0;
    }

    let payment = position_size * funding_rate * (hours_elapsed as i128) / (BASIS_POINTS as i128);

    match direction {
        Direction::Long => payment,   // Longs pay when rate is positive
        Direction::Short => -payment, // Shorts receive when rate is positive
    }
}

/// Calculate GLP tokens to mint for a USDC deposit.
///
/// # Formula
/// If pool is empty: glp_amount = usdc_amount (1:1 ratio)
/// Otherwise: glp_amount = usdc_amount × total_glp / aum
///
/// # Arguments
/// * `usdc_amount` - Amount of USDC being deposited (7 decimals)
/// * `total_glp` - Current total GLP supply (7 decimals)
/// * `aum` - Current Assets Under Management (7 decimals)
///
/// # Returns
/// GLP tokens to mint (7 decimals)
pub fn calculate_glp_for_deposit(usdc_amount: i128, total_glp: i128, aum: i128) -> Result<i128, NoetherError> {
    if total_glp == 0 || aum == 0 {
        // First depositor gets 1:1 ratio
        return Ok(usdc_amount);
    }

    // Proportional minting
    Ok(usdc_amount * total_glp / aum)
}

/// Calculate USDC to return for GLP withdrawal.
///
/// # Formula
/// usdc_amount = glp_amount × aum / total_glp
///
/// # Arguments
/// * `glp_amount` - Amount of GLP being burned (7 decimals)
/// * `total_glp` - Current total GLP supply (7 decimals)
/// * `aum` - Current Assets Under Management (7 decimals)
///
/// # Returns
/// USDC to return (7 decimals)
pub fn calculate_usdc_for_withdrawal(glp_amount: i128, total_glp: i128, aum: i128) -> Result<i128, NoetherError> {
    if total_glp == 0 {
        return Err(NoetherError::DivisionByZero);
    }

    Ok(glp_amount * aum / total_glp)
}

/// Calculate current GLP price.
///
/// # Formula
/// glp_price = aum / total_glp
///
/// # Arguments
/// * `total_glp` - Current total GLP supply (7 decimals)
/// * `aum` - Current Assets Under Management (7 decimals)
///
/// # Returns
/// GLP price in USDC (7 decimals)
pub fn calculate_glp_price(total_glp: i128, aum: i128) -> Result<i128, NoetherError> {
    if total_glp == 0 {
        // If no GLP exists, price is 1:1
        return Ok(PRECISION);
    }

    Ok(aum * PRECISION / total_glp)
}

/// Calculate trading fee.
///
/// # Arguments
/// * `position_size` - Size of the position (7 decimals)
/// * `fee_bps` - Fee in basis points
///
/// # Returns
/// Fee amount (7 decimals)
pub fn calculate_trading_fee(position_size: i128, fee_bps: u32) -> i128 {
    position_size * (fee_bps as i128) / (BASIS_POINTS as i128)
}

/// Safe multiplication that checks for overflow.
pub fn safe_mul(a: i128, b: i128) -> Result<i128, NoetherError> {
    a.checked_mul(b).ok_or(NoetherError::Overflow)
}

/// Safe division that checks for zero divisor.
pub fn safe_div(a: i128, b: i128) -> Result<i128, NoetherError> {
    if b == 0 {
        return Err(NoetherError::DivisionByZero);
    }
    Ok(a / b)
}

/// Safe addition that checks for overflow.
pub fn safe_add(a: i128, b: i128) -> Result<i128, NoetherError> {
    a.checked_add(b).ok_or(NoetherError::Overflow)
}

/// Safe subtraction that checks for underflow.
pub fn safe_sub(a: i128, b: i128) -> Result<i128, NoetherError> {
    a.checked_sub(b).ok_or(NoetherError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{Env, Address, Symbol};

    fn create_test_position(env: &Env, direction: Direction) -> Position {
        Position {
            id: 1,
            trader: Address::generate(env),
            asset: Symbol::new(env, "XLM"),
            collateral: 100 * PRECISION,  // 100 USDC
            size: 1000 * PRECISION,        // 1000 USD (10x)
            entry_price: PRECISION,         // $1.00
            direction,
            leverage: 10,
            liquidation_price: 0, // Will be calculated
            timestamp: 1000000,
            last_funding_time: 1000000,
            accumulated_funding: 0,
        }
    }

    #[test]
    fn test_position_size() {
        let collateral = 100 * PRECISION;  // 100 USDC
        let leverage = 10u32;
        let size = calculate_position_size(collateral, leverage);
        assert_eq!(size, 1000 * PRECISION);  // 1000 USD
    }

    #[test]
    fn test_liquidation_price_long() {
        let entry_price = PRECISION; // $1.00
        let leverage = 10u32;
        let maintenance_margin_bps = 100u32; // 1%

        let liq_price = calculate_liquidation_price(
            entry_price,
            leverage,
            Direction::Long,
            maintenance_margin_bps,
        );

        // At 10x leverage, 1/10 = 10% move liquidates
        // With 1% maintenance margin, liquidation at ~9% loss
        // liq_price should be ~0.91
        assert!(liq_price < entry_price);
        assert!(liq_price > entry_price * 85 / 100);
    }

    #[test]
    fn test_liquidation_price_short() {
        let entry_price = PRECISION; // $1.00
        let leverage = 10u32;
        let maintenance_margin_bps = 100u32; // 1%

        let liq_price = calculate_liquidation_price(
            entry_price,
            leverage,
            Direction::Short,
            maintenance_margin_bps,
        );

        // For shorts, liquidation price should be above entry
        assert!(liq_price > entry_price);
        assert!(liq_price < entry_price * 115 / 100);
    }

    #[test]
    fn test_pnl_long_profit() {
        let env = Env::default();
        let mut position = create_test_position(&env, Direction::Long);
        position.entry_price = PRECISION; // $1.00
        position.size = 1000 * PRECISION;  // $1000 position

        let current_price = PRECISION * 11 / 10; // $1.10 (10% up)
        let pnl = calculate_pnl(&position, current_price).unwrap();

        // 10% gain on $1000 = $100 profit
        assert_eq!(pnl, 100 * PRECISION);
    }

    #[test]
    fn test_pnl_long_loss() {
        let env = Env::default();
        let mut position = create_test_position(&env, Direction::Long);
        position.entry_price = PRECISION; // $1.00
        position.size = 1000 * PRECISION;

        let current_price = PRECISION * 9 / 10; // $0.90 (10% down)
        let pnl = calculate_pnl(&position, current_price).unwrap();

        // 10% loss on $1000 = -$100
        assert_eq!(pnl, -100 * PRECISION);
    }

    #[test]
    fn test_pnl_short_profit() {
        let env = Env::default();
        let mut position = create_test_position(&env, Direction::Short);
        position.entry_price = PRECISION;
        position.size = 1000 * PRECISION;

        let current_price = PRECISION * 9 / 10; // $0.90 (10% down)
        let pnl = calculate_pnl(&position, current_price).unwrap();

        // Shorts profit when price goes down
        assert_eq!(pnl, 100 * PRECISION);
    }

    #[test]
    fn test_glp_first_deposit() {
        let usdc_amount = 1000 * PRECISION;
        let glp = calculate_glp_for_deposit(usdc_amount, 0, 0).unwrap();

        // First deposit is 1:1
        assert_eq!(glp, usdc_amount);
    }

    #[test]
    fn test_glp_proportional_mint() {
        let total_glp = 1000 * PRECISION;
        let aum = 1100 * PRECISION; // GLP price = 1.1
        let deposit = 110 * PRECISION;

        let glp = calculate_glp_for_deposit(deposit, total_glp, aum).unwrap();

        // deposit / aum * total_glp = 110/1100 * 1000 = 100
        assert_eq!(glp, 100 * PRECISION);
    }

    #[test]
    fn test_funding_rate_balanced() {
        let rate = calculate_funding_rate(1000 * PRECISION, 1000 * PRECISION, 1);
        assert_eq!(rate, 0);
    }

    #[test]
    fn test_funding_rate_more_longs() {
        let rate = calculate_funding_rate(2000 * PRECISION, 1000 * PRECISION, 10);
        // 50% imbalance, longs pay shorts
        assert!(rate > 0);
    }

    #[test]
    fn test_funding_rate_more_shorts() {
        let rate = calculate_funding_rate(1000 * PRECISION, 2000 * PRECISION, 10);
        // 50% imbalance, shorts pay longs (negative rate)
        assert!(rate < 0);
    }
}
