//! # Trading Logic
//!
//! Core trading calculations and validations.
//! Includes maker/taker fee system with 14-day rolling volume tiers.

use noether_common::{Direction, Position, PRECISION, BASIS_POINTS, FeeTier, VolumeRecord, TraderFeeInfo};
use soroban_sdk::{Env, Vec};

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

// ═══════════════════════════════════════════════════════════════════════════
// Maker/Taker Fee System with Volume Tiers
// ═══════════════════════════════════════════════════════════════════════════

const VOLUME_WINDOW_DAYS: u64 = 14;
const SECONDS_PER_DAY: u64 = 86400;

/// Create default fee tiers.
///
/// | Tier | 14-Day Volume | Maker  | Taker  |
/// |------|--------------|--------|--------|
/// | 0    | $0 - $1M     | 0.02%  | 0.05%  |
/// | 1    | > $1M        | 0.015% | 0.04%  |
/// | 2    | > $5M        | 0.01%  | 0.03%  |
/// | 3    | > $25M       | 0.005% | 0.02%  |
pub fn default_fee_tiers(env: &Env) -> Vec<FeeTier> {
    let mut tiers = Vec::new(env);
    tiers.push_back(FeeTier {
        min_volume: 0,
        maker_fee_bps: 2,   // 0.02%
        taker_fee_bps: 5,   // 0.05%
    });
    tiers.push_back(FeeTier {
        min_volume: 1_000_000 * PRECISION, // $1M
        maker_fee_bps: 1,   // 0.015% -> using 1 bps (Soroban u32, we use half-bps below)
        taker_fee_bps: 4,   // 0.04%
    });
    tiers.push_back(FeeTier {
        min_volume: 5_000_000 * PRECISION, // $5M
        maker_fee_bps: 1,   // 0.01%
        taker_fee_bps: 3,   // 0.03%
    });
    tiers.push_back(FeeTier {
        min_volume: 25_000_000 * PRECISION, // $25M
        maker_fee_bps: 0,   // 0.005% -> 0 bps floor (sub-bps not representable in u32)
        taker_fee_bps: 2,   // 0.02%
    });
    tiers
}

/// Rotate the volume window, zeroing out expired days.
///
/// If days_since_update >= 14, all data is expired → reset everything.
/// If 0 < days_since_update < 14, zero out the days that have rolled past.
pub fn rotate_volume_window(env: &Env, record: &mut VolumeRecord, current_day: u64) {
    if record.last_update_day == 0 {
        // First ever update - initialize
        let mut volumes = Vec::new(env);
        for _ in 0..VOLUME_WINDOW_DAYS {
            volumes.push_back(0_i128);
        }
        record.daily_volumes = volumes;
        record.last_update_day = current_day;
        return;
    }

    let days_elapsed = current_day.saturating_sub(record.last_update_day);

    if days_elapsed == 0 {
        return; // Same day, nothing to rotate
    }

    if days_elapsed >= VOLUME_WINDOW_DAYS {
        // All data expired, reset
        let mut volumes = Vec::new(env);
        for _ in 0..VOLUME_WINDOW_DAYS {
            volumes.push_back(0_i128);
        }
        record.daily_volumes = volumes;
    } else {
        // Zero out the expired slots
        for i in 1..=days_elapsed {
            let slot = ((record.last_update_day + i) % VOLUME_WINDOW_DAYS) as u32;
            record.daily_volumes.set(slot, 0_i128);
        }
    }

    record.last_update_day = current_day;
}

/// Record a trade's volume in the 14-day rolling window.
pub fn record_trade_volume(env: &Env, record: &mut VolumeRecord, size: i128, current_day: u64) {
    rotate_volume_window(env, record, current_day);

    let slot = (current_day % VOLUME_WINDOW_DAYS) as u32;
    let current = record.daily_volumes.get(slot).unwrap_or(0);
    record.daily_volumes.set(slot, current + size);
}

/// Sum the 14-day rolling volume from a VolumeRecord.
pub fn sum_rolling_volume(record: &VolumeRecord) -> i128 {
    let mut total: i128 = 0;
    for i in 0..record.daily_volumes.len() {
        total += record.daily_volumes.get(i).unwrap_or(0);
    }
    total
}

/// Determine which fee tier a trader qualifies for based on their volume.
/// Returns the tier with the highest min_volume that the trader exceeds.
pub fn determine_fee_tier(volume: i128, tiers: &Vec<FeeTier>) -> FeeTier {
    let mut best = FeeTier {
        min_volume: 0,
        maker_fee_bps: 2,
        taker_fee_bps: 5,
    };

    for i in 0..tiers.len() {
        let tier = tiers.get(i).unwrap();
        if volume >= tier.min_volume {
            best = tier;
        }
    }

    best
}

/// Calculate the trading fee for a given trade.
///
/// # Arguments
/// * `size` - Position size (7 decimals)
/// * `is_maker` - true for limit orders resting on book, false for market orders
/// * `tier` - The trader's current fee tier
///
/// # Returns
/// Fee amount in USDC (7 decimals)
pub fn calculate_tiered_fee(size: i128, is_maker: bool, tier: &FeeTier) -> i128 {
    let fee_bps = if is_maker { tier.maker_fee_bps } else { tier.taker_fee_bps };
    size * (fee_bps as i128) / (BASIS_POINTS as i128)
}

/// Build a TraderFeeInfo view object for a trader.
pub fn build_trader_fee_info(
    _env: &Env,
    volume: i128,
    tiers: &Vec<FeeTier>,
) -> TraderFeeInfo {
    let tier = determine_fee_tier(volume, tiers);

    // Find current tier index and next tier volume
    let mut tier_index: u32 = 0;
    let mut next_tier_volume: i128 = 0;

    for i in 0..tiers.len() {
        let t = tiers.get(i).unwrap();
        if volume >= t.min_volume {
            tier_index = i;
        }
    }

    // Check if there's a next tier
    let next_idx = tier_index + 1;
    if next_idx < tiers.len() {
        let next_tier = tiers.get(next_idx).unwrap();
        next_tier_volume = next_tier.min_volume - volume;
        if next_tier_volume < 0 {
            next_tier_volume = 0;
        }
    }

    TraderFeeInfo {
        volume_14d: volume,
        tier: tier_index,
        maker_fee_bps: tier.maker_fee_bps,
        taker_fee_bps: tier.taker_fee_bps,
        next_tier_volume,
    }
}

/// Get the current day number from a unix timestamp.
pub fn timestamp_to_day(timestamp: u64) -> u64 {
    timestamp / SECONDS_PER_DAY
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{Env, Address, Symbol};
    use soroban_sdk::testutils::Address as _;

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

    fn create_empty_volume_record(env: &Env) -> VolumeRecord {
        VolumeRecord {
            daily_volumes: Vec::new(env),
            last_update_day: 0,
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

    // ═══════════════════════════════════════════════════════════════════
    // Fee Tier Tests
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn test_default_fee_tiers() {
        let env = Env::default();
        let tiers = default_fee_tiers(&env);
        assert_eq!(tiers.len(), 4);

        let t0 = tiers.get(0).unwrap();
        assert_eq!(t0.min_volume, 0);
        assert_eq!(t0.maker_fee_bps, 2);
        assert_eq!(t0.taker_fee_bps, 5);

        let t3 = tiers.get(3).unwrap();
        assert_eq!(t3.min_volume, 25_000_000 * PRECISION);
        assert_eq!(t3.taker_fee_bps, 2);
    }

    #[test]
    fn test_determine_fee_tier_base() {
        let env = Env::default();
        let tiers = default_fee_tiers(&env);

        // Zero volume → tier 0
        let tier = determine_fee_tier(0, &tiers);
        assert_eq!(tier.maker_fee_bps, 2);
        assert_eq!(tier.taker_fee_bps, 5);
    }

    #[test]
    fn test_determine_fee_tier_volume_1m() {
        let env = Env::default();
        let tiers = default_fee_tiers(&env);

        // $1.5M volume → tier 1
        let volume = 1_500_000 * PRECISION;
        let tier = determine_fee_tier(volume, &tiers);
        assert_eq!(tier.taker_fee_bps, 4);
    }

    #[test]
    fn test_determine_fee_tier_max() {
        let env = Env::default();
        let tiers = default_fee_tiers(&env);

        // $30M volume → tier 3
        let volume = 30_000_000 * PRECISION;
        let tier = determine_fee_tier(volume, &tiers);
        assert_eq!(tier.taker_fee_bps, 2);
    }

    #[test]
    fn test_calculate_tiered_fee_taker() {
        let tier = FeeTier { min_volume: 0, maker_fee_bps: 2, taker_fee_bps: 5 };
        let size = 10_000 * PRECISION; // $10k position

        let fee = calculate_tiered_fee(size, false, &tier);
        // 0.05% of $10,000 = $5
        assert_eq!(fee, 5 * PRECISION);
    }

    #[test]
    fn test_calculate_tiered_fee_maker() {
        let tier = FeeTier { min_volume: 0, maker_fee_bps: 2, taker_fee_bps: 5 };
        let size = 10_000 * PRECISION; // $10k position

        let fee = calculate_tiered_fee(size, true, &tier);
        // 0.02% of $10,000 = $2
        assert_eq!(fee, 2 * PRECISION);
    }

    #[test]
    fn test_volume_record_first_trade() {
        let env = Env::default();
        let mut record = create_empty_volume_record(&env);
        let day = 19437_u64; // some day number

        record_trade_volume(&env, &mut record, 1000 * PRECISION, day);

        assert_eq!(record.daily_volumes.len(), 14);
        assert_eq!(record.last_update_day, day);
        assert_eq!(sum_rolling_volume(&record), 1000 * PRECISION);
    }

    #[test]
    fn test_volume_record_same_day() {
        let env = Env::default();
        let mut record = create_empty_volume_record(&env);
        let day = 19437_u64;

        record_trade_volume(&env, &mut record, 500 * PRECISION, day);
        record_trade_volume(&env, &mut record, 300 * PRECISION, day);

        assert_eq!(sum_rolling_volume(&record), 800 * PRECISION);
    }

    #[test]
    fn test_volume_record_next_day() {
        let env = Env::default();
        let mut record = create_empty_volume_record(&env);

        record_trade_volume(&env, &mut record, 1000 * PRECISION, 100);
        record_trade_volume(&env, &mut record, 2000 * PRECISION, 101);

        assert_eq!(sum_rolling_volume(&record), 3000 * PRECISION);
    }

    #[test]
    fn test_volume_record_expiry_after_14_days() {
        let env = Env::default();
        let mut record = create_empty_volume_record(&env);

        // Trade on day 100
        record_trade_volume(&env, &mut record, 1000 * PRECISION, 100);
        assert_eq!(sum_rolling_volume(&record), 1000 * PRECISION);

        // 14 days later, all data expired
        record_trade_volume(&env, &mut record, 500 * PRECISION, 114);
        assert_eq!(sum_rolling_volume(&record), 500 * PRECISION);
    }

    #[test]
    fn test_volume_record_partial_expiry() {
        let env = Env::default();
        let mut record = create_empty_volume_record(&env);

        // Trades on day 100 and 101
        record_trade_volume(&env, &mut record, 1000 * PRECISION, 100);
        record_trade_volume(&env, &mut record, 2000 * PRECISION, 101);

        // 10 days later: day 100 is still in window (< 14), day 101 too
        record_trade_volume(&env, &mut record, 500 * PRECISION, 110);
        assert_eq!(sum_rolling_volume(&record), 3500 * PRECISION);

        // Day 114: day 100 slot should be zeroed (100+14=114)
        record_trade_volume(&env, &mut record, 100 * PRECISION, 114);
        // Day 100 expired, day 101 still in window (101+14=115)
        // Total = 2000 (day 101) + 500 (day 110) + 100 (day 114)
        assert_eq!(sum_rolling_volume(&record), 2600 * PRECISION);
    }

    #[test]
    fn test_build_trader_fee_info() {
        let env = Env::default();
        let tiers = default_fee_tiers(&env);
        let volume = 3_000_000 * PRECISION; // $3M → tier 1

        let info = build_trader_fee_info(&env, volume, &tiers);

        assert_eq!(info.tier, 1);
        assert_eq!(info.taker_fee_bps, 4);
        assert_eq!(info.volume_14d, volume);
        // Next tier is $5M, need $2M more
        assert_eq!(info.next_tier_volume, 2_000_000 * PRECISION);
    }

    #[test]
    fn test_build_trader_fee_info_max_tier() {
        let env = Env::default();
        let tiers = default_fee_tiers(&env);
        let volume = 50_000_000 * PRECISION; // $50M → tier 3 (max)

        let info = build_trader_fee_info(&env, volume, &tiers);

        assert_eq!(info.tier, 3);
        assert_eq!(info.next_tier_volume, 0); // Already max tier
    }

    #[test]
    fn test_timestamp_to_day() {
        // 2024-01-01 00:00:00 UTC = 1704067200
        assert_eq!(timestamp_to_day(1704067200), 19723);
        // Same day, later
        assert_eq!(timestamp_to_day(1704067200 + 43200), 19723);
        // Next day
        assert_eq!(timestamp_to_day(1704067200 + 86400), 19724);
    }
}
