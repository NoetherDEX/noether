//! # Position Management
//!
//! Position-related utilities and helpers.
//! Includes cross-margin account equity calculations per Stellar security best practices:
//! - Checked arithmetic to prevent overflow
//! - Atomic equity checks in withdrawal path

use soroban_sdk::{Address, Env, Symbol};
use noether_common::{BASIS_POINTS, Position, calculate_pnl, calculate_cumulative_funding};
use crate::storage::{
    get_position,
    get_cross_margin_balance, get_cross_margin_position_ids,
    get_funding_state,
    get_asset_risk, get_risk_epoch_ts,
};

/// Maintenance-margin bps for one position (L0-12). Positions opened before
/// the ladder went live (RiskEpochTs), or on an asset with no params, keep
/// the legacy `fallback_bps` — so an in-place ladder upgrade liquidates
/// nobody retroactively and pre-ladder deployments behave exactly as before.
pub fn mm_bps_for(env: &Env, pos: &Position, fallback_bps: u32) -> u32 {
    let epoch = get_risk_epoch_ts(env);
    if epoch == 0 || pos.timestamp < epoch {
        return fallback_bps;
    }
    get_asset_risk(env, &pos.asset).map(|p| p.mm_bps).unwrap_or(fallback_bps)
}

// Removed unused helpers for WASM size: has_open_positions, get_trader_total_value,
// get_trader_total_collateral, calculate_total_unrealized_pnl, validate_position_params

// ═══════════════════════════════════════════════════════════════════════════
// Cross-Margin Account Calculations
// Single-pass iteration for WASM size efficiency (Stellar best practice)
// ═══════════════════════════════════════════════════════════════════════════

/// Aggregated cross-margin account state from single position iteration.
struct CrossAggregates {
    /// Sum of collateral locked in all cross positions
    total_collateral: i128,
    /// Sum of unrealized PnL across all cross positions
    unrealized_pnl: i128,
    /// Sum of funding payments (from cumulative model)
    total_funding: i128,
    /// Sum of maintenance margin required
    maintenance_margin: i128,
    /// Sum of initial margin used (size / leverage)
    used_margin: i128,
}

/// Calculate all cross-margin aggregates in a single pass over positions.
///
/// Equity formula (matches Binance cross-margin):
///   equity = pool_balance + total_collateral + unrealized_pnl - total_funding
///
/// Where pool_balance is the residual in the pool after positions took collateral,
/// and total_collateral is the sum of collateral locked in open positions.
/// Together they equal the total amount deposited + PnL - funding.
fn aggregate_cross_positions(
    env: &Env,
    trader: &Address,
    maintenance_margin_bps: u32,
    get_price: &dyn Fn(&Symbol) -> i128,
) -> CrossAggregates {
    let position_ids = get_cross_margin_position_ids(env, trader);

    let mut agg = CrossAggregates {
        total_collateral: 0,
        unrealized_pnl: 0,
        total_funding: 0,
        maintenance_margin: 0,
        used_margin: 0,
    };

    for i in 0..position_ids.len() {
        let id = position_ids.get(i).unwrap();
        if let Some(pos) = get_position(env, id) {
            // Collateral in position (must be counted toward equity!)
            agg.total_collateral = agg.total_collateral.checked_add(pos.collateral).unwrap_or(agg.total_collateral);
            // PnL. Fail closed on an unreadable/bogus price: value the leg at
            // -size (deep loss) so equity can only be UNDERSTATED, never
            // inflated. This is the correct direction for the withdraw/open
            // free-margin gates — a dead feed blocks risk-increasing actions
            // instead of fabricating +size profit for shorts
            // (calculate_pnl(short, 0) = +size). The liquidation path
            // pre-screens every price, so this branch never fires there (where
            // -size would be the wrong direction and falsely liquidate).
            let price = get_price(&pos.asset);
            let pnl = if price <= 0 {
                -pos.size
            } else {
                calculate_pnl(&pos, price).unwrap_or(-pos.size)
            };
            agg.unrealized_pnl = agg.unrealized_pnl.checked_add(pnl).unwrap_or(agg.unrealized_pnl);
            // Funding from the position's OWN asset index (L0-13 per-market).
            let current_cumulative = get_funding_state(env, &pos.asset).0;
            let pos_funding = calculate_cumulative_funding(
                pos.size, pos.direction,
                pos.entry_cumulative_funding, current_cumulative,
            );
            agg.total_funding = agg.total_funding.checked_add(pos_funding).unwrap_or(agg.total_funding);
            // Maintenance margin — per-asset once the ladder is live (L0-12),
            // legacy fallback for grandfathered / pre-ladder positions.
            let mm_bps = mm_bps_for(env, &pos, maintenance_margin_bps);
            let mm = pos.size * (mm_bps as i128) / (BASIS_POINTS as i128);
            agg.maintenance_margin = agg.maintenance_margin.checked_add(mm).unwrap_or(agg.maintenance_margin);
            // Used margin (initial margin = size / leverage)
            let im = pos.size / (pos.leverage as i128);
            agg.used_margin = agg.used_margin.checked_add(im).unwrap_or(agg.used_margin);
        }
    }

    agg
}

/// Calculate cross-margin account equity.
///
/// equity = pool_balance + sum(position_collateral) + sum(unrealized_pnl) - sum(funding)
///
/// This correctly accounts for collateral locked inside positions.
/// pool_balance + total_collateral = total amount originally deposited (minus fees).
pub fn calculate_cross_equity(
    env: &Env,
    trader: &Address,
    get_price: &dyn Fn(&Symbol) -> i128,
) -> i128 {
    let balance = get_cross_margin_balance(env, trader);
    let agg = aggregate_cross_positions(env, trader, 0, get_price);
    // equity = pool_balance + collateral_in_positions + unrealized_pnl - funding
    balance
        .checked_add(agg.total_collateral).unwrap_or(balance)
        .checked_add(agg.unrealized_pnl).unwrap_or(balance)
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

/// Aggregate initial (used) margin for all cross positions (L1-5).
/// IM_agg = Σ size_i / leverage_i — price-free, so an oracle failure can
/// never fabricate free-margin headroom. This is the withdraw/open floor;
/// maintenance margin (a strictly smaller number at 1-10x) stays the
/// liquidation trigger, leaving the IM→MM span as the de-risk band.
pub fn calculate_cross_used_margin(
    env: &Env,
    trader: &Address,
) -> i128 {
    let no_price = |_: &Symbol| -> i128 { 0 };
    // maintenance_margin_bps is irrelevant to used_margin; pass 0.
    let agg = aggregate_cross_positions(env, trader, 0, &no_price);
    agg.used_margin
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
    let equity = balance
        .checked_add(agg.total_collateral).unwrap_or(balance)
        .checked_add(agg.unrealized_pnl).unwrap_or(balance)
        .checked_sub(agg.total_funding).unwrap_or(0);
    equity < agg.maintenance_margin
}

// build_cross_margin_info removed for WASM size - frontend computes client-side
