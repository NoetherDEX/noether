//! # Risk-engine primitives (Tranche 3)
//!
//! Pure, unit-tested building blocks for the mainnet risk engine
//! (TASKS.md Phase 5). Kept here in `noether_common` — free of storage and
//! `Env` — so the market, the dedicated `risk` contract, the vault, and the
//! keeper all share ONE definition of the math and can be cargo-tested with
//! no ledger. Parameters follow the audit's risk sheet
//! (`docs/AUDIT-2026-06.md` Part 2.2 #10).

use soroban_sdk::contracttype;

use crate::types::{BASIS_POINTS, PRECISION};

/// Per-market risk parameters (P5-1). The rollout vehicle for new pairs:
/// an admin stores one of these per asset in the `risk` contract, and the
/// market/keeper read them instead of the single global `MarketConfig`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RiskConfig {
    /// Initial margin in bps (e.g. 400 = 4% → 25x). Also caps leverage.
    pub im_bps: u32,
    /// Maintenance margin in bps. Invariant MM = IM/2 (P5-2).
    pub mm_bps: u32,
    /// Per-side open-interest cap as bps of vault AUM (BTC 2500 / ETH 2000 /
    /// XLM 1000 / new pairs 500).
    pub oi_cap_bps: u32,
    /// Net-skew cap as bps of AUM (1000-1500).
    pub skew_cap_bps: u32,
    /// Max funding-rate velocity per day, bps (SIP-279; ~36%/day = 360000).
    pub max_funding_velocity_bps: u32,
    /// Funding clamp: max |rate| per hour, bps (majors 50 = 0.5%/hr).
    pub funding_clamp_bps: u32,
    /// Hourly borrow-fee rate at 0% / target(80%) / 100% utilization, in
    /// FEE_PRECISION units (deci-bps): dual-slope (P5-4).
    pub borrow_base_fee: u32,
    pub borrow_target_fee: u32,
    pub borrow_max_fee: u32,
}

impl RiskConfig {
    /// BTC/ETH-class major: 25x (IM 4% / MM 2%).
    pub fn major(oi_cap_bps: u32) -> Self {
        RiskConfig {
            im_bps: 400,
            mm_bps: 200,
            oi_cap_bps,
            skew_cap_bps: 1_500,
            max_funding_velocity_bps: 360_000,
            funding_clamp_bps: 50,
            borrow_base_fee: 1,    // ~0.001%/hr
            borrow_target_fee: 8,  // ~0.008%/hr @ 80%
            borrow_max_fee: 60,    // ~0.06%/hr @ 100%
        }
    }

    /// XLM-class: 10x (IM 10% / MM 5%).
    pub fn xlm() -> Self {
        RiskConfig {
            im_bps: 1_000,
            mm_bps: 500,
            oi_cap_bps: 1_000,
            skew_cap_bps: 1_500,
            max_funding_velocity_bps: 360_000,
            funding_clamp_bps: 100, // alts ±1%/hr
            borrow_base_fee: 1,
            borrow_target_fee: 8,
            borrow_max_fee: 60,
        }
    }

    /// New/long-tail pair launch defaults: 5x, 5%-TVL cap.
    pub fn new_pair() -> Self {
        RiskConfig {
            im_bps: 2_000, // 5x
            mm_bps: 1_000,
            oi_cap_bps: 500,
            skew_cap_bps: 1_000,
            max_funding_velocity_bps: 360_000,
            funding_clamp_bps: 100,
            borrow_base_fee: 1,
            borrow_target_fee: 8,
            borrow_max_fee: 60,
        }
    }

    /// Structural invariant the admin setter enforces: MM = IM/2, both
    /// positive, MM < IM, leverage implied by IM ≤ 25x.
    pub fn is_valid(&self) -> bool {
        self.im_bps > 0
            && self.mm_bps > 0
            && self.mm_bps < self.im_bps
            && self.mm_bps == self.im_bps / 2
            && self.im_bps >= 400 // ≤ 25x
            && self.oi_cap_bps > 0
            && self.oi_cap_bps <= BASIS_POINTS
    }

    /// Max leverage implied by the initial margin (10000/im_bps).
    pub fn max_leverage(&self) -> u32 {
        if self.im_bps == 0 {
            0
        } else {
            BASIS_POINTS / self.im_bps
        }
    }
}

/// SIP-279 funding VELOCITY (P5-3): `dr/dt = maxVelocity × skew / skewScale`.
/// Returns the per-`elapsed_seconds` change in the hourly funding rate (bps,
/// PRECISION-scaled sub-bps), signed by skew (positive = longs pay). The
/// caller integrates this into the lazy cumulative index. skew_scale is
/// conventionally 2× the per-market OI cap; passing 0 yields 0 (no market).
pub fn funding_velocity(
    net_skew: i128,
    skew_scale: i128,
    max_velocity_bps: u32,
    elapsed_seconds: u64,
) -> i128 {
    if skew_scale <= 0 || elapsed_seconds == 0 {
        return 0;
    }
    // velocity per day (bps, PRECISION-scaled) × skew fraction
    let per_day = (max_velocity_bps as i128) * PRECISION * net_skew / skew_scale;
    // pro-rate to the elapsed window (86400 s/day)
    per_day * (elapsed_seconds as i128) / 86_400
}

/// Clamp an hourly funding rate to ±clamp_bps (PRECISION-scaled).
pub fn clamp_funding(rate: i128, clamp_bps: u32) -> i128 {
    let limit = (clamp_bps as i128) * PRECISION;
    if rate > limit {
        limit
    } else if rate < -limit {
        -limit
    } else {
        rate
    }
}

/// Dual-slope borrow fee (P5-4): the hourly rate at a given utilization
/// (bps of TVL reserved). Linear base→target up to `target_util_bps`, then
/// steeper target→max up to 100%. Returns FEE_PRECISION units (deci-bps).
pub fn borrow_fee_rate(
    utilization_bps: u32,
    target_util_bps: u32,
    base_fee: u32,
    target_fee: u32,
    max_fee: u32,
) -> u32 {
    let util = utilization_bps.min(BASIS_POINTS);
    if util <= target_util_bps {
        if target_util_bps == 0 {
            return base_fee;
        }
        // base + (target-base) × util/target
        base_fee + (target_fee.saturating_sub(base_fee)) * util / target_util_bps
    } else {
        let span = BASIS_POINTS - target_util_bps;
        if span == 0 {
            return max_fee;
        }
        target_fee + (max_fee.saturating_sub(target_fee)) * (util - target_util_bps) / span
    }
}

/// Partial-liquidation tranche size (P5-5): close `tranche_bps` of the
/// position, but never below `min_notional` and never above the whole
/// position. Below `full_close_notional` (≈ 2/3 MM territory, decided by
/// the caller) the caller should full-close instead — this returns the
/// tranche only.
pub fn partial_liq_tranche(position_size: i128, tranche_bps: u32, min_notional: i128) -> i128 {
    if position_size <= 0 {
        return 0;
    }
    let mut tranche = position_size * (tranche_bps as i128) / (BASIS_POINTS as i128);
    if tranche < min_notional {
        tranche = min_notional;
    }
    if tranche > position_size {
        tranche = position_size;
    }
    tranche
}

/// ADL priority key (P5-7): profitable positions are force-closed in order
/// of `PnL% × leverage` (industry-universal). Higher key = closed first.
/// Returns 0 for non-positive PnL (never an ADL candidate). PnL% is in bps
/// of collateral.
pub fn adl_rank(pnl: i128, collateral: i128, leverage: u32) -> i128 {
    if pnl <= 0 || collateral <= 0 {
        return 0;
    }
    let pnl_pct_bps = pnl * (BASIS_POINTS as i128) / collateral;
    pnl_pct_bps * (leverage as i128)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn major_config_holds_mm_is_im_over_two() {
        let c = RiskConfig::major(2_500);
        assert!(c.is_valid());
        assert_eq!(c.mm_bps, c.im_bps / 2);
        assert_eq!(c.max_leverage(), 25);
    }

    #[test]
    fn xlm_and_new_pair_valid() {
        assert!(RiskConfig::xlm().is_valid());
        assert!(RiskConfig::new_pair().is_valid());
        assert_eq!(RiskConfig::xlm().max_leverage(), 10);
        assert_eq!(RiskConfig::new_pair().max_leverage(), 5);
    }

    #[test]
    fn invalid_config_rejected() {
        let mut c = RiskConfig::major(2_500);
        c.mm_bps = c.im_bps; // MM must be < IM and == IM/2
        assert!(!c.is_valid());
    }

    #[test]
    fn funding_velocity_signs_with_skew_and_prorates() {
        // Longs heavier → positive velocity (longs pay). skewScale = 2× cap.
        let up = funding_velocity(100 * PRECISION, 200 * PRECISION, 360_000, 3_600);
        assert!(up > 0);
        // Shorts heavier → negative.
        let down = funding_velocity(-100 * PRECISION, 200 * PRECISION, 360_000, 3_600);
        assert_eq!(down, -up);
        // Half the window → half the velocity.
        let half = funding_velocity(100 * PRECISION, 200 * PRECISION, 360_000, 1_800);
        assert_eq!(half, up / 2);
        // No market (skewScale 0) → 0.
        assert_eq!(funding_velocity(100, 0, 360_000, 3_600), 0);
    }

    #[test]
    fn funding_clamp_bounds_both_directions() {
        let clamp = 50u32; // 0.5%/hr
        let limit = (clamp as i128) * PRECISION;
        assert_eq!(clamp_funding(limit * 10, clamp), limit);
        assert_eq!(clamp_funding(-limit * 10, clamp), -limit);
        assert_eq!(clamp_funding(limit / 2, clamp), limit / 2);
    }

    #[test]
    fn borrow_fee_dual_slope() {
        let (target, base, tfee, max) = (8_000u32, 1u32, 8u32, 60u32);
        assert_eq!(borrow_fee_rate(0, target, base, tfee, max), base);
        assert_eq!(borrow_fee_rate(8_000, target, base, tfee, max), tfee);
        assert_eq!(borrow_fee_rate(10_000, target, base, tfee, max), max);
        // Between base and target, monotonic increasing.
        let mid = borrow_fee_rate(4_000, target, base, tfee, max);
        assert!(mid > base && mid < tfee);
        // Above target, steeper.
        let hi = borrow_fee_rate(9_000, target, base, tfee, max);
        assert!(hi > tfee && hi < max);
    }

    #[test]
    fn partial_liq_tranche_respects_floor_and_ceiling() {
        // 20% of 1000 = 200, above the 50 floor.
        assert_eq!(partial_liq_tranche(1_000, 2_000, 50), 200);
        // Tranche below floor → floor.
        assert_eq!(partial_liq_tranche(1_000, 100, 50), 50);
        // Floor above position → whole position.
        assert_eq!(partial_liq_tranche(30, 2_000, 50), 30);
    }

    #[test]
    fn adl_rank_orders_by_pnl_pct_times_leverage() {
        // Same PnL%, higher leverage ranks first.
        let a = adl_rank(50, 100, 10); // 50% × 10
        let b = adl_rank(50, 100, 5); //  50% ×  5
        assert!(a > b);
        // Losing position is never a candidate.
        assert_eq!(adl_rank(-10, 100, 10), 0);
    }
}
