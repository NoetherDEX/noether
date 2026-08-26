/**
 * Pool-capacity headroom — a transliteration of the vault's
 * `reserve_for_position` gates (contracts/vault/src/lib.rs) so the gateway,
 * the order panel and the SDKs can tell a trader how much notional a market
 * can take BEFORE they sign, instead of learning it from a #82 / #89 toast.
 *
 * The vault runs four checks, in this order, on every open (L0-14):
 *
 *   1. reserved + amount            > aum × reserve_cap_bps / 10_000   → #82 (aggregate)
 *   2. side_oi_after                > min(aum × asset_cap_bps / 10_000, cap_abs) → #82 (side)
 *   3. |net_after| > skew_cap AND |net_after| > |net_before|          → #89 (skew)
 *   4. reserved + amount            > usdc_balance − shortfall_reserve → InsufficientLiquidity
 *
 * where `amount` is the FULL position notional (collateral × leverage),
 * `net = long_oi − short_oi` from the market's AssetExposure(asset), and
 * skew-REDUCING opens always pass gate 3. Everything here is i128-style
 * bigint arithmetic on 7-decimal USDC; `bps × aum / 10_000` truncates toward
 * zero exactly like the contract because aum ≥ 0.
 *
 * Headroom is advisory by construction (cache + ledger close race; AUM moves
 * with unrealized PnL every ledger). The contract stays the authority and the
 * #82/#89 error toasts stay as the backstop.
 */

export type PositionSide = 'long' | 'short';

/** Which gate would fire first if the order grew by one more unit. */
export type CapacityBinding = 'aggregate' | 'side' | 'skew' | 'liquidity' | 'maxPosition';

/** Vault rejection reasons, named after the gate that fires. */
export type CapacityRejectReason = 'aggregate' | 'side' | 'skew' | 'liquidity';

export interface CapacityInputs {
  /** vault.get_aum — 7-dec USDC. */
  aum: bigint;
  /** vault.get_reserved_payout — committed max payouts of open positions. */
  reservedPayout: bigint;
  /** vault.get_reserve_cap — bps of AUM the aggregate reservation may reach. */
  reserveCapBps: number;
  /** vault.get_usdc_balance — physical USDC held by the vault. */
  usdcBalance: bigint;
  /** vault.get_shortfall_reserve — USDC earmarked for shortfall repayment. */
  shortfallReserve: bigint;
  /** vault.get_asset_caps(asset)[0] — per-side OI cap, bps of AUM. */
  assetCapBps: number;
  /** vault.get_asset_caps(asset)[1] — absolute per-side cap; 0 = bps-only. */
  capAbs: bigint;
  /** vault.get_asset_caps(asset)[2] — net-skew cap, bps of AUM. */
  skewCapBps: number;
  /** market AssetExposure(asset).long_size — open long notional. */
  longOi: bigint;
  /** market AssetExposure(asset).short_size — open short notional. */
  shortOi: bigint;
  /** market.get_asset_risk(asset).max_position_size; null/undefined = unknown. */
  maxPositionSize?: bigint | null;
}

export interface SideHeadroom {
  /** Largest notional the vault accepts for this side right now (≥ 0). */
  headroom: bigint;
  binding: CapacityBinding;
}

export interface CapacityHeadroom {
  long: SideHeadroom;
  short: SideHeadroom;
  /** min(reserveCap − reserved, usdc − shortfall − reserved), floored at 0. */
  aggregateHeadroom: bigint;
  aggregateBinding: 'aggregate' | 'liquidity';
  reserveCap: bigint;
  /** Effective per-side cap: min(bps leg, capAbs when set). */
  sideCap: bigint;
  skewCap: bigint;
  /** long − short. */
  net: bigint;
}

const BPS = 10_000n;

const abs = (x: bigint): bigint => (x < 0n ? -x : x);
const floor0 = (x: bigint): bigint => (x < 0n ? 0n : x);

export function reserveCapOf(i: Pick<CapacityInputs, 'aum' | 'reserveCapBps'>): bigint {
  return (i.aum * BigInt(i.reserveCapBps)) / BPS;
}

export function sideCapOf(i: Pick<CapacityInputs, 'aum' | 'assetCapBps' | 'capAbs'>): bigint {
  const leg = (i.aum * BigInt(i.assetCapBps)) / BPS;
  return i.capAbs > 0n && i.capAbs < leg ? i.capAbs : leg;
}

export function skewCapOf(i: Pick<CapacityInputs, 'aum' | 'skewCapBps'>): bigint {
  return (i.aum * BigInt(i.skewCapBps)) / BPS;
}

/**
 * Exactly what the vault decides for an open of `size` notional on `side`,
 * gate by gate in the contract's order. `size ≤ 0` is the contract's
 * InvalidAmount — reported as not-ok without a gate reason.
 */
export function vaultAccepts(
  i: CapacityInputs,
  side: PositionSide,
  size: bigint,
): { ok: boolean; reason?: CapacityRejectReason } {
  if (size <= 0n) return { ok: false };
  if (i.reservedPayout + size > reserveCapOf(i)) return { ok: false, reason: 'aggregate' };
  const sideAfter = (side === 'long' ? i.longOi : i.shortOi) + size;
  if (sideAfter > sideCapOf(i)) return { ok: false, reason: 'side' };
  const before = i.longOi - i.shortOi;
  const after = side === 'long' ? before + size : before - size;
  if (abs(after) > skewCapOf(i) && abs(after) > abs(before)) return { ok: false, reason: 'skew' };
  if (i.reservedPayout + size > i.usdcBalance - i.shortfallReserve) {
    return { ok: false, reason: 'liquidity' };
  }
  return { ok: true };
}

/**
 * Largest notional gate 3 accepts on `side`, given net = long − short.
 *
 * Increasing side (same sign as net, or a flat book): |net| + size ≤ cap.
 * Reducing side: the open first shrinks |net| (always allowed), then flips
 * it; the flipped |after| = size − |net| must stay ≤ cap, OR stay ≤ the old
 * |net| (the contract only rejects when the open makes |net| strictly worse)
 * — which is what lets a book already past a tightened cap keep taking the
 * trades that help it. Room = |net| + max(cap, |net|).
 */
export function skewRoom(net: bigint, skewCap: bigint, side: PositionSide): bigint {
  const a = abs(net);
  const increasing = net === 0n || (side === 'long') === net > 0n;
  if (increasing) return skewCap - a;
  return a + (a > skewCap ? a : skewCap);
}

/**
 * Per-side headroom = min over every gate's room (plus the market's
 * max_position_size when known), floored at 0. `binding` is the gate that
 * produced the minimum; ties resolve in the contract's check order so that
 * `vaultAccepts(headroom + 1).reason === binding` whenever the binding is a
 * vault gate.
 */
export function computeHeadroom(i: CapacityInputs): CapacityHeadroom {
  const reserveCap = reserveCapOf(i);
  const sideCap = sideCapOf(i);
  const skewCap = skewCapOf(i);
  const net = i.longOi - i.shortOi;
  const aggRoom = reserveCap - i.reservedPayout;
  const liqRoom = i.usdcBalance - i.shortfallReserve - i.reservedPayout;
  const maxPos = i.maxPositionSize != null && i.maxPositionSize > 0n ? i.maxPositionSize : null;

  const forSide = (side: PositionSide): SideHeadroom => {
    const terms: Array<[CapacityBinding, bigint]> = [
      ['aggregate', aggRoom],
      ['side', sideCap - (side === 'long' ? i.longOi : i.shortOi)],
      ['skew', skewRoom(net, skewCap, side)],
      ['liquidity', liqRoom],
    ];
    if (maxPos !== null) terms.push(['maxPosition', maxPos]);
    let best = terms[0]!;
    for (let k = 1; k < terms.length; k++) {
      if (terms[k]![1] < best[1]) best = terms[k]!;
    }
    return { headroom: floor0(best[1]), binding: best[0] };
  };

  return {
    long: forSide('long'),
    short: forSide('short'),
    aggregateHeadroom: floor0(liqRoom < aggRoom ? liqRoom : aggRoom),
    aggregateBinding: liqRoom < aggRoom ? 'liquidity' : 'aggregate',
    reserveCap,
    sideCap,
    skewCap,
    net,
  };
}
