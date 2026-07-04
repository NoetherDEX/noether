/**
 * Market stats (open interest, 24h volume) sourced from the indexer
 * projection via the gateway — replaces the hardcoded trade-page values
 * (W-3/P4-6). Prices are i128 strings with 7-decimal precision.
 */

const API_BASE = process.env.NEXT_PUBLIC_NOETHER_API_URL ?? 'http://localhost:4000';

const PRECISION = 10_000_000;

export interface AssetMarketStats {
  asset: string;
  openInterestLong: string;
  openInterestShort: string;
  openInterestNet: string;
  openPositions: number;
  volume24h: string;
}

export interface MarketsStats {
  assets: AssetMarketStats[];
}

/** Fetch per-asset stats for all markets. Returns null on any failure so
 *  callers can fall back to a neutral placeholder rather than crash. */
export async function getMarketsStats(): Promise<MarketsStats | null> {
  try {
    const res = await fetch(`${API_BASE}/v1/markets/stats`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as MarketsStats;
  } catch {
    return null;
  }
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
