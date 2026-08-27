/**
 * Market stats (open interest, 24h volume, pool-capacity headroom) sourced
 * from the gateway's GET /v1/markets/stats — replaces the hardcoded
 * trade-page values (W-3/P4-6). Prices are i128 strings with 7-decimal
 * precision.
 *
 * Response shape is `{ stats, solvency, pool? }` — `stats` is the per-asset
 * array (the client used to read a non-existent `assets` key, which left the
 * OI tiles at "—" since 2026-07-04; `getMarketsStats` now validates the shape).
 *
 * `capacity` (per asset) and `pool` (vault-wide) are the L1-13 headroom
 * blocks: chain-read, advisory, and OMITTED by the gateway when its read
 * failed — never zeros. Consumers must treat their absence as "unknown".
 */

import { apiBase } from './base';

const PRECISION = 10_000_000;

/** Which vault gate binds first if the order grew by one more unit. */
export type CapacityBinding = 'aggregate' | 'side' | 'skew' | 'liquidity' | 'maxPosition';

export interface AssetCapacity {
  /** Largest notional the vault accepts for a new long/short right now (7-dec strings). */
  headroomLong: string;
  headroomShort: string;
  bindingLong: CapacityBinding;
  bindingShort: CapacityBinding;
  /** Chain AssetExposure — the vault's exact inputs (long, short, long − short). */
  oiLong: string;
  oiShort: string;
  netSkew: string;
  /** Effective per-side OI cap and net-skew cap, in notional. */
  sideCap: string;
  skewCap: string;
  assetCapBps: number;
  capAbs: string;
  skewCapBps: number;
  /** market max_position_size; null when unset on chain. */
  maxPositionSize: string | null;
}

export interface PoolCapacity {
  aum: string;
  reservedPayout: string;
  usdcBalance: string;
  shortfallReserve: string;
  reserveCapBps: number;
  reserveCap: string;
  aggregateHeadroom: string;
  aggregateBinding: 'aggregate' | 'liquidity';
  asOfLedger: number | null;
  ts: number;
  stale: boolean;
}

export interface AssetMarketStats {
  asset: string;
  openInterestLong: string;
  openInterestShort: string;
  openInterestNet: string;
  openPositions: number;
  volume24h: string;
  /** Present only when the gateway's chain read succeeded. */
  capacity?: AssetCapacity;
}

export interface SolvencyStats {
  cumulativeBadDebtCovered: string;
  cumulativeBadDebtLpAbsorbed: string;
  badDebtEvents: number;
}

export interface MarketsStats {
  stats: AssetMarketStats[];
  solvency?: SolvencyStats;
  /** Present only when the gateway's chain read succeeded. */
  pool?: PoolCapacity;
}

/** Fetch per-asset stats for all markets. Returns null on any failure —
 *  including an unexpected shape — so callers fall back to a neutral
 *  placeholder rather than crash or render fabricated numbers. */
export async function getMarketsStats(): Promise<MarketsStats | null> {
  try {
    // apiBase() may throw on a misconfigured prod deploy — caught below → null.
    const res = await fetch(`${apiBase()}/v1/markets/stats`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<MarketsStats> | null;
    if (!body || !Array.isArray(body.stats)) return null;
    return body as MarketsStats;
  } catch {
    return null;
  }
}

/** The selected asset's row, or null when stats are unknown. */
export function selectAssetStats(
  stats: MarketsStats | null | undefined,
  asset: string,
): AssetMarketStats | null {
  return stats?.stats.find((a) => a.asset === asset) ?? null;
}

/** The selected asset's capacity block, or null when unknown (no clamp). */
export function selectCapacity(
  stats: MarketsStats | null | undefined,
  asset: string,
): AssetCapacity | null {
  return selectAssetStats(stats, asset)?.capacity ?? null;
}

/** i128 string (7-decimal) → whole USD number. */
export function statToUsd(value: string | undefined): number {
  if (!value) return 0;
  try {
    return Number(BigInt(value)) / PRECISION;
  } catch {
    return 0;
  }
}
