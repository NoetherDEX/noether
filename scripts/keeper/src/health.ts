/**
 * Noether Keeper Bot - Local Liquidation Health Math (P2-9)
 *
 * The market contract removed `is_liquidatable` / `should_execute_order`
 * for WASM size. The keeper now prefilters liquidation candidates LOCALLY
 * using cached positions + the prices it pushed itself, then confirms via
 * `simulateTransaction(market.liquidate(...))` — the simulation is the
 * on-chain truth; this module only decides what is worth simulating.
 *
 * All math mirrors `contracts/noether_common/src/math.rs` exactly:
 * 7-decimal fixed point, i128 semantics (BigInt division truncates toward
 * zero, same as Rust integer division). No floats, no network — this file
 * is exercised offline by `npm run smoke`.
 */

/** 7-decimal fixed point (1.0 = 10_000_000) — matches contract PRECISION. */
export const PRECISION = 10_000_000n;

/** 10_000 bps = 100% — matches contract BASIS_POINTS. */
export const BASIS_POINTS = 10_000n;

/** Contract default maintenance margin (types.rs default: 100 bps = 1%). */
export const DEFAULT_MAINTENANCE_MARGIN_BPS = 100n;

/**
 * Prefilter buffer: a position is a simulation candidate when its locally
 * computed margin is below `maintenance_margin × BUFFER`. The buffer
 * absorbs what the keeper cannot know locally — pending cumulative funding
 * (not exposed as a view) and small price drift between pushes. Funding
 * accrues at ~0.01%/h of size at full imbalance, so a 2× buffer (an extra
 * 1% of size at the default 100 bps margin) covers ~100 hours of drift;
 * the periodic full sweep in index.ts bounds anything beyond that.
 */
export const CANDIDATE_BUFFER = 2n;

/** Minimal position shape needed for health math (structural subset of Position). */
export interface HealthPosition {
  asset: string;
  collateral: bigint;
  size: bigint;
  entry_price: bigint;
  direction: 'Long' | 'Short';
  liquidation_price: bigint;
}

/**
 * Mirror of math.rs `calculate_pnl`:
 *   Long:  pnl = size × (current − entry) / entry
 *   Short: pnl = size × (entry − current) / entry
 * Returns 0 for a zero entry price (the contract errors there; a broken
 * position is left for the simulation to judge).
 */
export function calculatePnl(position: HealthPosition, currentPrice: bigint): bigint {
  if (position.entry_price === 0n) return 0n;
  const priceDiff =
    position.direction === 'Long'
      ? currentPrice - position.entry_price
      : position.entry_price - currentPrice;
  return (position.size * priceDiff) / position.entry_price;
}

/** margin = collateral + pnl − funding (funding defaults to 0 — see CANDIDATE_BUFFER). */
export function positionMargin(
  position: HealthPosition,
  currentPrice: bigint,
  funding: bigint = 0n,
): bigint {
  return position.collateral + calculatePnl(position, currentPrice) - funding;
}

/** maintenance margin = size × maintenance_margin_bps / 10_000 */
export function maintenanceMargin(
  size: bigint,
  maintenanceMarginBps: bigint = DEFAULT_MAINTENANCE_MARGIN_BPS,
): bigint {
  return (size * maintenanceMarginBps) / BASIS_POINTS;
}

/**
 * Mirror of math.rs `should_liquidate`: the stored liquidation price is
 * crossed. Cross-margin positions store 0 (account-level liquidation) —
 * treated as "not crossed".
 */
export function crossesLiquidationPrice(position: HealthPosition, currentPrice: bigint): boolean {
  if (position.liquidation_price <= 0n) return false;
  return position.direction === 'Long'
    ? currentPrice <= position.liquidation_price
    : currentPrice >= position.liquidation_price;
}

/**
 * Exact mirror of the contract's `should_liquidate_with_funding` (with the
 * funding term supplied by the caller): liquidatable when the stored
 * liquidation price is crossed OR margin < size × mm_bps / 10_000.
 */
export function isUnderwater(
  position: HealthPosition,
  currentPrice: bigint,
  maintenanceMarginBps: bigint = DEFAULT_MAINTENANCE_MARGIN_BPS,
  funding: bigint = 0n,
): boolean {
  if (crossesLiquidationPrice(position, currentPrice)) return true;
  return (
    positionMargin(position, currentPrice, funding) <
    maintenanceMargin(position.size, maintenanceMarginBps)
  );
}

/**
 * Cheap local prefilter (funding unknown locally → buffered threshold).
 * True means "worth spending a liquidate simulation on".
 */
export function isLiquidationCandidate(
  position: HealthPosition,
  currentPrice: bigint,
  maintenanceMarginBps: bigint = DEFAULT_MAINTENANCE_MARGIN_BPS,
  buffer: bigint = CANDIDATE_BUFFER,
): boolean {
  if (crossesLiquidationPrice(position, currentPrice)) return true;
  return (
    positionMargin(position, currentPrice) <
    maintenanceMargin(position.size, maintenanceMarginBps) * buffer
  );
}

/**
 * Cross-margin account prefilter, mirroring position.rs
 * `is_cross_account_liquidatable` (minus the funding term — buffered):
 *   equity = pool_balance + Σ collateral + Σ pnl
 *   candidate when equity < Σ maintenance_margin × buffer
 * Missing local price for any position → candidate (conservative: let the
 * on-chain preflight simulation decide).
 */
export function isCrossLiquidationCandidate(
  poolBalance: bigint,
  positions: HealthPosition[],
  prices: Map<string, bigint>,
  maintenanceMarginBps: bigint = DEFAULT_MAINTENANCE_MARGIN_BPS,
  buffer: bigint = CANDIDATE_BUFFER,
): boolean {
  if (positions.length === 0) return false;

  let equity = poolBalance;
  let totalMaintenance = 0n;

  for (const position of positions) {
    const price = prices.get(position.asset);
    if (price === undefined || price <= 0n) return true;
    equity += position.collateral + calculatePnl(position, price);
    totalMaintenance += maintenanceMargin(position.size, maintenanceMarginBps);
  }

  return equity < totalMaintenance * buffer;
}

/**
 * ADL ranking score (L0-1) — the ADVISORY order in which the keeper walks
 * winners when ADL is active for an asset. Mirrors the contract's inlined
 * formula (and contracts/risk::adl_rank): PnL% of collateral, in bps,
 * multiplied by leverage. Losers (pnl <= 0) never rank.
 *
 * The on-chain adl_close gate (flag active + net winner) is the consensus;
 * this only decides submission order, so exact parity with the contract's
 * integer truncation is the only requirement.
 */
export function adlRank(pnl: bigint, collateral: bigint, leverage: bigint): bigint {
  if (pnl <= 0n || collateral <= 0n) return 0n;
  return ((pnl * BASIS_POINTS) / collateral) * leverage;
}
