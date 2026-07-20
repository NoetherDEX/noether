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
  maintenanceMarginBps: bigint | ((position: HealthPosition) => bigint) = DEFAULT_MAINTENANCE_MARGIN_BPS,
  buffer: bigint = CANDIDATE_BUFFER,
): boolean {
  if (positions.length === 0) return false;

  let equity = poolBalance;
  let totalMaintenance = 0n;

  for (const position of positions) {
    const price = prices.get(position.asset);
    if (price === undefined || price <= 0n) return true;
    equity += position.collateral + calculatePnl(position, price);
    // L0-12: mm may vary per asset — accept a per-position resolver, so
    // the cross sum mirrors the contract's per-leg mm_bps_for.
    const mmBps =
      typeof maintenanceMarginBps === 'function'
        ? maintenanceMarginBps(position)
        : maintenanceMarginBps;
    totalMaintenance += maintenanceMargin(position.size, mmBps);
  }

  return equity < totalMaintenance * buffer;
}

/**
 * Cross-account equity at the keeper's local prices (L0-9 interim):
 * pool_balance + Σ collateral + Σ pnl. Returns null when any leg's price
 * is missing — bankruptcy can't be judged, so callers must NOT treat the
 * account as bankrupt. Used only for the two-strike bankruptcy override;
 * the on-chain preflight stays the liquidation truth.
 */
export function crossEquity(
  poolBalance: bigint,
  positions: HealthPosition[],
  prices: Map<string, bigint>,
): bigint | null {
  let equity = poolBalance;
  for (const position of positions) {
    const price = prices.get(position.asset);
    if (price === undefined || price <= 0n) return null;
    equity += position.collateral + calculatePnl(position, price);
  }
  return equity;
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

/** Position shape for ADL candidate math (structural subset of Position). */
export interface AdlPosition extends HealthPosition {
  id: bigint;
  leverage: number;
}

/**
 * Mirror of check_adl_trigger's payable-uPnL aggregation (L0-1): per-side
 * exposure tuples with per-position truncation, exactly like the
 * contract's adjust_oi bookkeeping —
 *   lk += size × PRECISION / entry (long qty), ls += size (long notional)
 *   long_upnl  = price × lk / PRECISION − ls
 *   short_upnl = ss − price × sk / PRECISION
 *   payable    = max(long_upnl, 0) + max(short_upnl, 0)
 * The per-side clamp understates mixed-side winner totals — accepted, same
 * as on-chain (the shortfall auto-flip backstops it).
 */
export function assetPayableUpnl(positions: HealthPosition[], price: bigint): bigint {
  if (price <= 0n) return 0n;
  let lk = 0n;
  let ls = 0n;
  let sk = 0n;
  let ss = 0n;
  for (const position of positions) {
    if (position.entry_price <= 0n) continue;
    const qty = (position.size * PRECISION) / position.entry_price;
    if (position.direction === 'Long') {
      lk += qty;
      ls += position.size;
    } else {
      sk += qty;
      ss += position.size;
    }
  }
  const longUpnl = (price * lk) / PRECISION - ls;
  const shortUpnl = ss - (price * sk) / PRECISION;
  return (longUpnl > 0n ? longUpnl : 0n) + (shortUpnl > 0n ? shortUpnl : 0n);
}

export type AdlFlagDecision = 'activate' | 'clear' | 'hold';

/**
 * Local mirror of the trigger/clear hysteresis (L0-1):
 *   activate (flag off): payable > 0 and coverage × 10_000 < payable × trigger_bps
 *   clear (flag on):     payable == 0 or coverage × 10_000 ≥ payable × clear_bps
 * Decides when a check_adl_trigger simulation is WORTH SPENDING — the
 * simulation against live on-chain coverage is always the truth.
 */
export function adlFlagDecision(
  payable: bigint,
  coverage: bigint,
  active: boolean,
  triggerBps: bigint,
  clearBps: bigint,
): AdlFlagDecision {
  if (!active) {
    if (payable > 0n && coverage * BASIS_POINTS < payable * triggerBps) return 'activate';
    return 'hold';
  }
  if (payable === 0n || coverage * BASIS_POINTS >= payable * clearBps) return 'clear';
  return 'hold';
}

/**
 * Advisory ADL walk order (L0-1): positive-pnl positions on one asset,
 * highest adlRank first, ties broken by lower id (deterministic). The
 * on-chain #84/#85 gates are the consensus; this only orders submissions.
 */
export function rankAdlCandidates<T extends AdlPosition>(
  positions: T[],
  price: bigint,
): Array<{ position: T; pnl: bigint; score: bigint }> {
  const ranked: Array<{ position: T; pnl: bigint; score: bigint }> = [];
  for (const position of positions) {
    const pnl = calculatePnl(position, price);
    if (pnl <= 0n) continue;
    ranked.push({
      position,
      pnl,
      score: adlRank(pnl, position.collateral, BigInt(position.leverage)),
    });
  }
  ranked.sort((a, b) => {
    if (a.score !== b.score) return b.score > a.score ? 1 : -1;
    return a.position.id < b.position.id ? -1 : 1;
  });
  return ranked;
}
