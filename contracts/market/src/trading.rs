//! # Trading Logic
//!
//! Core trading calculations and validations.
//! Includes maker/taker fee system with 14-day rolling volume tiers.

use noether_common::{Direction, Position, PRECISION, BASIS_POINTS, FEE_PRECISION, FeeTier, VolumeRecord, TraderFeeInfo};
use soroban_sdk::{Env, Vec};

// Unused helpers removed for WASM size: calculate_effective_leverage, calculate_margin_ratio,
// calculate_max_loss, has_sufficient_margin, calculate_break_even_price, calculate_partial_close

// ═══════════════════════════════════════════════════════════════════════════
// Maker/Taker Fee System with Volume Tiers
// ═══════════════════════════════════════════════════════════════════════════

const VOLUME_WINDOW_DAYS: u64 = 14;
const SECONDS_PER_DAY: u64 = 86400;

/// Create default fee tiers using deci-bps (0.1 bps = 0.001% precision).
///
/// | Tier | 14-Day Volume | Maker       | Taker       |
/// |------|--------------|-------------|-------------|
/// | 0    | $0 - $1M     | 0.020% (20) | 0.050% (50) |
/// | 1    | > $1M        | 0.015% (15) | 0.040% (40) |
/// | 2    | > $5M        | 0.010% (10) | 0.030% (30) |
/// | 3    | > $25M       | 0.005% (5)  | 0.020% (20) |
pub fn default_fee_tiers(env: &Env) -> Vec<FeeTier> {
    let mut tiers = Vec::new(env);
    tiers.push_back(FeeTier {
        min_volume: 0,
        maker_fee_bps: 20,  // 2.0 deci-bps = 0.020%
        taker_fee_bps: 50,  // 5.0 deci-bps = 0.050%
    });
    tiers.push_back(FeeTier {
        min_volume: 20_000 * PRECISION, // $20K (testnet)
        maker_fee_bps: 15,  // 1.5 deci-bps = 0.015%
        taker_fee_bps: 40,  // 4.0 deci-bps = 0.040%
    });
    tiers.push_back(FeeTier {
        min_volume: 50_000 * PRECISION, // $50K (testnet)
        maker_fee_bps: 10,  // 1.0 deci-bps = 0.010%
        taker_fee_bps: 30,  // 3.0 deci-bps = 0.030%
    });
    tiers.push_back(FeeTier {
        min_volume: 100_000 * PRECISION, // $100K (testnet)
        maker_fee_bps: 5,   // 0.5 deci-bps = 0.005%
        taker_fee_bps: 20,  // 2.0 deci-bps = 0.020%
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
        maker_fee_bps: 20,  // 2.0 deci-bps default
        taker_fee_bps: 50,  // 5.0 deci-bps default
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
/// Fee rates are in deci-bps (0.1 bps), so we divide by FEE_PRECISION (100_000).
///
/// # Arguments
/// * `size` - Position size (7 decimals)
/// * `is_maker` - true for limit orders resting on book, false for market orders
/// * `tier` - The trader's current fee tier (rates in deci-bps)
///
/// # Returns
/// Fee amount in USDC (7 decimals)
pub fn calculate_tiered_fee(size: i128, is_maker: bool, tier: &FeeTier) -> i128 {
    let fee_units = if is_maker { tier.maker_fee_bps } else { tier.taker_fee_bps };
    size * (fee_units as i128) / FEE_PRECISION
}

// build_trader_fee_info removed for WASM size - frontend computes client-side

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
            margin_mode: 0,
        }
    }

    fn create_empty_volume_record(env: &Env) -> VolumeRecord {
        VolumeRecord {
            daily_volumes: Vec::new(env),
            last_update_day: 0,
        }
    }

    // Removed tests for deleted functions: calculate_effective_leverage, calculate_margin_ratio,
    // has_sufficient_margin, calculate_partial_close

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
        assert_eq!(t0.maker_fee_bps, 20);  // 2.0 deci-bps = 0.020%
        assert_eq!(t0.taker_fee_bps, 50);  // 5.0 deci-bps = 0.050%

        let t1 = tiers.get(1).unwrap();
        assert_eq!(t1.maker_fee_bps, 15);  // 1.5 deci-bps = 0.015% (previously couldn't represent!)

        let t3 = tiers.get(3).unwrap();
        assert_eq!(t3.min_volume, 100_000 * PRECISION);
        assert_eq!(t3.maker_fee_bps, 5);   // 0.5 deci-bps = 0.005%
        assert_eq!(t3.taker_fee_bps, 20);  // 2.0 deci-bps = 0.020%
    }

    #[test]
    fn test_determine_fee_tier_base() {
        let env = Env::default();
        let tiers = default_fee_tiers(&env);

        // Zero volume → tier 0
        let tier = determine_fee_tier(0, &tiers);
        assert_eq!(tier.maker_fee_bps, 20);
        assert_eq!(tier.taker_fee_bps, 50);
    }

    #[test]
    fn test_determine_fee_tier_volume_1m() {
        let env = Env::default();
        let tiers = default_fee_tiers(&env);

        // $1.5M volume → tier 1
        let volume = 1_500_000 * PRECISION;
        let tier = determine_fee_tier(volume, &tiers);
        assert_eq!(tier.taker_fee_bps, 40);
        assert_eq!(tier.maker_fee_bps, 15); // Now correctly represents 1.5 bps!
    }

    #[test]
    fn test_determine_fee_tier_volume_5m() {
        let env = Env::default();
        let tiers = default_fee_tiers(&env);

        // $7M volume → tier 2
        let volume = 7_000_000 * PRECISION;
        let tier = determine_fee_tier(volume, &tiers);
        assert_eq!(tier.maker_fee_bps, 10);
        assert_eq!(tier.taker_fee_bps, 30);
    }

    #[test]
    fn test_determine_fee_tier_max() {
        let env = Env::default();
        let tiers = default_fee_tiers(&env);

        // $30M volume → tier 3
        let volume = 30_000_000 * PRECISION;
        let tier = determine_fee_tier(volume, &tiers);
        assert_eq!(tier.taker_fee_bps, 20);
    }

    #[test]
    fn test_calculate_tiered_fee_taker() {
        let tier = FeeTier { min_volume: 0, maker_fee_bps: 20, taker_fee_bps: 50 };
        let size = 10_000 * PRECISION; // $10k position

        let fee = calculate_tiered_fee(size, false, &tier);
        // 50 deci-bps = 0.050% of $10,000 = $5
        assert_eq!(fee, 5 * PRECISION);
    }

    #[test]
    fn test_calculate_tiered_fee_maker() {
        let tier = FeeTier { min_volume: 0, maker_fee_bps: 20, taker_fee_bps: 50 };
        let size = 10_000 * PRECISION; // $10k position

        let fee = calculate_tiered_fee(size, true, &tier);
        // 20 deci-bps = 0.020% of $10,000 = $2
        assert_eq!(fee, 2 * PRECISION);
    }

    #[test]
    fn test_calculate_tiered_fee_sub_bps() {
        // Tier 1: 1.5 bps maker
        let tier = FeeTier { min_volume: 0, maker_fee_bps: 15, taker_fee_bps: 40 };
        let size = 10_000 * PRECISION; // $10k

        let fee = calculate_tiered_fee(size, true, &tier);
        // 15 deci-bps = 0.015% of $10,000 = $1.50
        assert_eq!(fee, PRECISION * 3 / 2); // 1.5 USDC
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

    // build_trader_fee_info tests removed - function was removed for WASM size

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
