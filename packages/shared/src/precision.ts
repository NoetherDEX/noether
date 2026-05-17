/**
 * Stellar / Soroban native precision helpers.
 *
 * Stellar represents fixed-point values as 7-decimal integers throughout
 * the system: 1.0 USDC is stored as 10_000_000. These helpers convert
 * between user-facing decimal numbers and on-chain integer representation.
 */

export const PRECISION_DECIMALS = 7;
export const PRECISION_MULTIPLIER = 10_000_000n;
export const BASIS_POINTS = 10_000;

/**
 * Convert a 7-decimal integer (bigint) to a JavaScript number.
 * Use only for display / numeric reasoning; precision is lost beyond 2^53.
 */
export function fromPrecision(value: bigint, decimals = PRECISION_DECIMALS): number {
  if (decimals === PRECISION_DECIMALS) {
    return Number(value) / Number(PRECISION_MULTIPLIER);
  }
  const divisor = 10n ** BigInt(decimals);
  return Number(value) / Number(divisor);
}

/**
 * Convert a JavaScript number to a 7-decimal integer (bigint).
 * Rounds toward zero — callers requiring banker's rounding should round upstream.
 */
export function toPrecision(value: number, decimals = PRECISION_DECIMALS): bigint {
  const multiplier = decimals === PRECISION_DECIMALS
    ? PRECISION_MULTIPLIER
    : 10n ** BigInt(decimals);
  return BigInt(Math.trunc(value * Number(multiplier)));
}

/**
 * Format a 7-decimal integer as a fixed-precision string for display.
 * Avoids floating-point rounding by working on the bigint directly.
 */
export function formatPrecision(
  value: bigint,
  decimals = PRECISION_DECIMALS,
  displayDecimals = 2,
): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = abs % divisor;
  const fracStr = frac.toString().padStart(decimals, '0');
  const trimmed = displayDecimals >= decimals
    ? fracStr
    : fracStr.slice(0, displayDecimals);
  const sign = negative ? '-' : '';
  return displayDecimals === 0 ? `${sign}${whole}` : `${sign}${whole}.${trimmed}`;
}

/**
 * Convert basis points to a fractional number. 50 bps = 0.005.
 */
export function bpsToFraction(bps: number): number {
  return bps / BASIS_POINTS;
}
