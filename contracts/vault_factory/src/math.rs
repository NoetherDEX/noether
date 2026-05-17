//! Share / NAV math.
//!
//! Pure functions, no Soroban dependencies — fully unit testable
//! without spinning up an `Env`. Uses i128 with checked arithmetic
//! everywhere; an overflow surfaces as `FactoryError::Overflow`.

use crate::types::{FactoryError, PRECISION};

/// Compute NAV per share scaled by PRECISION.
/// First share has value 1.0 (PRECISION). After realised activity the
/// caller passes total_usdc (deposits + realised PnL - withdrawals).
pub fn nav_per_share(total_usdc: i128, circulating_shares: i128) -> Result<i128, FactoryError> {
    if circulating_shares <= 0 {
        return Ok(PRECISION);
    }
    if total_usdc < 0 {
        return Err(FactoryError::NavCalculationFailed);
    }
    let scaled = total_usdc.checked_mul(PRECISION).ok_or(FactoryError::Overflow)?;
    Ok(scaled / circulating_shares)
}

/// Shares minted for a USDC deposit.
///
/// First deposit: 1 share per USDC (scaled by PRECISION).
/// Subsequent: amount * circulating / total_usdc.
pub fn shares_for_deposit(
    amount: i128,
    total_usdc: i128,
    circulating_shares: i128,
) -> Result<i128, FactoryError> {
    if amount <= 0 {
        return Err(FactoryError::AmountMustBePositive);
    }
    if circulating_shares == 0 || total_usdc == 0 {
        return Ok(amount);
    }
    if total_usdc < 0 || circulating_shares < 0 {
        return Err(FactoryError::NavCalculationFailed);
    }
    let scaled = amount
        .checked_mul(circulating_shares)
        .ok_or(FactoryError::Overflow)?;
    Ok(scaled / total_usdc)
}

/// USDC returned for a share burn.
pub fn usdc_for_withdraw(
    shares: i128,
    total_usdc: i128,
    circulating_shares: i128,
) -> Result<i128, FactoryError> {
    if shares <= 0 {
        return Err(FactoryError::AmountMustBePositive);
    }
    if circulating_shares <= 0 {
        return Err(FactoryError::InsufficientShares);
    }
    if shares > circulating_shares {
        return Err(FactoryError::InsufficientShares);
    }
    if total_usdc <= 0 {
        return Ok(0);
    }
    let scaled = shares.checked_mul(total_usdc).ok_or(FactoryError::Overflow)?;
    Ok(scaled / circulating_shares)
}

/// True when the leader holds at least LEADER_MIN_HOLDING_BPS bps of
/// circulating shares (default 5%). Empty vaults trivially pass.
pub fn leader_min_holding_ok(
    leader_shares: i128,
    circulating_shares: i128,
    min_holding_bps: u32,
) -> bool {
    if circulating_shares <= 0 {
        return true;
    }
    if leader_shares < 0 {
        return false;
    }
    // leader_shares * BPS_DENOM >= circulating_shares * min_holding_bps
    let lhs = leader_shares.saturating_mul(crate::types::BPS_DENOM as i128);
    let rhs = circulating_shares.saturating_mul(min_holding_bps as i128);
    lhs >= rhs
}

/// Profit-share owed to the leader on the gain above HWM.
/// Returns 0 when current NAV is at or below HWM.
pub fn leader_profit_owed(
    total_usdc: i128,
    circulating_shares: i128,
    hwm_nav: i128,
    profit_share_bps: u32,
) -> Result<i128, FactoryError> {
    if circulating_shares <= 0 {
        return Ok(0);
    }
    let current_nav = nav_per_share(total_usdc, circulating_shares)?;
    if current_nav <= hwm_nav {
        return Ok(0);
    }
    // gain_per_share (PRECISION-scaled) * shares / PRECISION = USDC of total gain
    let gain_per_share = current_nav - hwm_nav;
    let total_gain_scaled = gain_per_share
        .checked_mul(circulating_shares)
        .ok_or(FactoryError::Overflow)?;
    let total_gain_usdc = total_gain_scaled / PRECISION;
    // share = total_gain * bps / 10_000
    let share = total_gain_usdc
        .checked_mul(profit_share_bps as i128)
        .ok_or(FactoryError::Overflow)?
        / 10_000;
    Ok(share)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_deposit_is_one_to_one() {
        let s = shares_for_deposit(1_000_0000000, 0, 0).unwrap();
        assert_eq!(s, 1_000_0000000);
    }

    #[test]
    fn proportional_deposit_after_pnl_dilutes_correctly() {
        // Vault: 1000 USDC -> 1000 shares, then 500 USDC profit grew vault to 1500.
        // New depositor of 300 USDC should get 300 * 1000 / 1500 = 200 shares.
        let s = shares_for_deposit(300, 1500, 1000).unwrap();
        assert_eq!(s, 200);
    }

    #[test]
    fn withdraw_pays_pro_rata() {
        // Vault: 1500 USDC, 1000 shares. Burn 200 shares -> 300 USDC.
        let usdc = usdc_for_withdraw(200, 1500, 1000).unwrap();
        assert_eq!(usdc, 300);
    }

    #[test]
    fn nav_at_creation_is_one() {
        assert_eq!(nav_per_share(0, 0).unwrap(), PRECISION);
        assert_eq!(nav_per_share(0, 100).unwrap(), 0);
    }

    #[test]
    fn nav_after_profit() {
        // 1000 USDC -> 1000 shares -> NAV = 1.0
        assert_eq!(nav_per_share(1000, 1000).unwrap(), PRECISION);
        // gain to 1200 -> NAV = 1.2
        assert_eq!(nav_per_share(1200, 1000).unwrap(), PRECISION * 12 / 10);
    }

    #[test]
    fn leader_profit_zero_below_hwm() {
        // NAV = 0.9, HWM = 1.0  -> no profit owed.
        let owed = leader_profit_owed(900, 1000, PRECISION, 1_000).unwrap();
        assert_eq!(owed, 0);
    }

    #[test]
    fn leader_profit_owed_above_hwm() {
        // 1000 shares, NAV grew from 1.0 (HWM) to 1.2 -> 200 USDC gain.
        // Leader takes 10% = 20 USDC.
        let owed = leader_profit_owed(1200, 1000, PRECISION, 1_000).unwrap();
        assert_eq!(owed, 20);
    }

    #[test]
    fn deposit_zero_or_negative_rejected() {
        assert_eq!(
            shares_for_deposit(0, 100, 100).unwrap_err(),
            FactoryError::AmountMustBePositive,
        );
        assert_eq!(
            shares_for_deposit(-5, 100, 100).unwrap_err(),
            FactoryError::AmountMustBePositive,
        );
    }

    #[test]
    fn withdraw_more_than_supply_rejected() {
        assert_eq!(
            usdc_for_withdraw(2000, 1500, 1000).unwrap_err(),
            FactoryError::InsufficientShares,
        );
    }

    #[test]
    fn leader_min_holding_empty_vault_ok() {
        assert!(leader_min_holding_ok(0, 0, 500));
    }

    #[test]
    fn leader_min_holding_at_threshold_passes() {
        // 5% min: leader has exactly 50 of 1000 shares.
        assert!(leader_min_holding_ok(50, 1000, 500));
    }

    #[test]
    fn leader_min_holding_below_threshold_fails() {
        // 5% min: leader has 49 of 1000 shares (4.9%).
        assert!(!leader_min_holding_ok(49, 1000, 500));
    }

    #[test]
    fn leader_min_holding_well_above_threshold_passes() {
        assert!(leader_min_holding_ok(100, 1000, 500));
    }

    #[test]
    fn deposit_overflow_returns_overflow() {
        // amount * circulating must overflow; amount=i128::MAX/2, circulating=3
        let r = shares_for_deposit(i128::MAX / 2, 1, 3);
        assert_eq!(r.unwrap_err(), FactoryError::Overflow);
    }
}
