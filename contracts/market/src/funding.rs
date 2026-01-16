//! # Funding Rate Logic
//!
//! Funding rate calculations to balance long/short interest.
//!
//! ## Funding Rate Mechanism
//!
//! The funding rate incentivizes balance between longs and shorts:
//! - If there are more longs than shorts: **longs pay shorts**
//! - If there are more shorts than longs: **shorts pay longs**
//!
//! This keeps the perpetual price close to the spot price.
//!
//! ## Formula
//!
//! ```
//! imbalance = (dominant_side - minority_side) / dominant_side
//! funding_rate = base_rate * imbalance
//! ```
//!
//! ## Application
//!
//! Funding is applied hourly. The payment per position is:
//! ```
//! funding_payment = position_size * funding_rate * hours_elapsed
//! ```

use noether_common::{Direction, BASIS_POINTS};

/// Calculate the funding rate based on open interest imbalance.
///
/// # Arguments
/// * `total_long_size` - Total size of all long positions
/// * `total_short_size` - Total size of all short positions
/// * `base_rate_bps` - Base funding rate in basis points per hour
///
/// # Returns
/// Funding rate in basis points (can be negative).
/// Positive = longs pay shorts.
/// Negative = shorts pay longs.
pub fn calculate_funding_rate_internal(
    total_long_size: i128,
    total_short_size: i128,
    base_rate_bps: u32,
) -> i128 {
    // Balanced market = no funding
    if total_long_size == 0 && total_short_size == 0 {
        return 0;
    }

    if total_long_size == total_short_size {
        return 0;
    }

    let base = base_rate_bps as i128;

    if total_long_size > total_short_size {
        // More longs - longs pay
        if total_long_size == 0 {
            return 0;
        }
        let imbalance = (total_long_size - total_short_size) * (BASIS_POINTS as i128) / total_long_size;
        base * imbalance / (BASIS_POINTS as i128)
    } else {
        // More shorts - shorts pay (negative rate)
        if total_short_size == 0 {
            return 0;
        }
        let imbalance = (total_short_size - total_long_size) * (BASIS_POINTS as i128) / total_short_size;
        -(base * imbalance / (BASIS_POINTS as i128))
    }
}

/// Calculate funding payment for a specific position.
///
/// # Arguments
/// * `position_size` - Size of the position
/// * `funding_rate` - Current funding rate in basis points
/// * `direction` - Position direction
/// * `hours_elapsed` - Hours since last funding application
///
/// # Returns
/// Payment amount (positive = pay, negative = receive)
pub fn calculate_funding_payment_internal(
    position_size: i128,
    funding_rate: i128,
    direction: Direction,
    hours_elapsed: u64,
) -> i128 {
    if hours_elapsed == 0 || funding_rate == 0 {
        return 0;
    }

    let base_payment = position_size * funding_rate.abs() * (hours_elapsed as i128)
        / (BASIS_POINTS as i128);

    match direction {
        Direction::Long => {
            if funding_rate > 0 {
                base_payment  // Longs pay when rate positive
            } else {
                -base_payment // Longs receive when rate negative
            }
        }
        Direction::Short => {
            if funding_rate > 0 {
                -base_payment // Shorts receive when rate positive
            } else {
                base_payment  // Shorts pay when rate negative
            }
        }
    }
}

/// Calculate the annualized funding rate for display.
pub fn calculate_annualized_rate(hourly_rate_bps: i128) -> i128 {
    // 8760 hours in a year
    hourly_rate_bps * 8760
}

/// Estimate daily funding cost for a position.
pub fn estimate_daily_funding(position_size: i128, hourly_rate_bps: i128) -> i128 {
    position_size * hourly_rate_bps.abs() * 24 / (BASIS_POINTS as i128)
}

/// Calculate the time until next funding application.
pub fn time_until_next_funding(last_funding_time: u64, current_time: u64, interval: u64) -> u64 {
    let time_since = current_time.saturating_sub(last_funding_time);

    if time_since >= interval {
        0 // Can apply now
    } else {
        interval - time_since
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_balanced_market() {
        let rate = calculate_funding_rate_internal(
            1000 * PRECISION,
            1000 * PRECISION,
            10, // 0.1% base
        );
        assert_eq!(rate, 0);
    }

    #[test]
    fn test_more_longs() {
        let rate = calculate_funding_rate_internal(
            2000 * PRECISION,  // 2000 long
            1000 * PRECISION,  // 1000 short
            10,
        );
        // 50% imbalance, rate should be positive (longs pay)
        assert!(rate > 0);
        assert_eq!(rate, 5); // 50% of 10 bps
    }

    #[test]
    fn test_more_shorts() {
        let rate = calculate_funding_rate_internal(
            1000 * PRECISION,
            2000 * PRECISION,
            10,
        );
        // 50% imbalance, rate should be negative (shorts pay)
        assert!(rate < 0);
        assert_eq!(rate, -5);
    }

    #[test]
    fn test_funding_payment_long_positive_rate() {
        let payment = calculate_funding_payment_internal(
            1000 * PRECISION, // $1000 position
            10,               // 0.1% rate (longs pay)
            Direction::Long,
            1,                // 1 hour
        );
        // $1000 * 0.1% = $1 payment
        assert_eq!(payment, PRECISION);
    }

    #[test]
    fn test_funding_payment_short_positive_rate() {
        let payment = calculate_funding_payment_internal(
            1000 * PRECISION,
            10,              // Longs pay, shorts receive
            Direction::Short,
            1,
        );
        // Shorts receive $1
        assert_eq!(payment, -PRECISION);
    }

    #[test]
    fn test_annualized_rate() {
        let hourly = 10i128; // 0.1% per hour
        let annual = calculate_annualized_rate(hourly);
        assert_eq!(annual, 87600); // 876% APR
    }

    #[test]
    fn test_time_until_funding() {
        let last = 1000u64;
        let current = 2000u64;
        let interval = 3600u64; // 1 hour

        let remaining = time_until_next_funding(last, current, interval);
        assert_eq!(remaining, 2600); // 3600 - 1000 seconds remaining
    }
}
