/**
 * Trailing 14-day traded notional for a wallet, from the indexer-backed
 * gateway (`GET /v1/account/volume`). Seeds the OrderPanel fee-tier preview
 * while the on-chain `get_trader_fee_info` view stays removed for WASM size.
 *
 * Estimate semantics: the gateway sums position_opened + position_closed
 * events — the same trades the contract's VolumeRecord counts — but is not
 * the fee-charging source of truth, so callers keep labeling fees "Est.".
 */

import { apiBase } from './base';
import { gatewayServesThisMarket } from './gateway';

/** 14-day rolling volume in whole USD (7-decimal units divided out), or
 *  null when the gateway is unconfigured, unreachable, or serving a
 *  different market era — callers then fall back to session accumulation. */
export async function fetchTraderVolume14d(address: string): Promise<number | null> {
  try {
    if (!(await gatewayServesThisMarket())) return null;
    const res = await fetch(
      `${apiBase()}/v1/account/volume?address=${encodeURIComponent(address)}`,
      { headers: { accept: 'application/json' }, cache: 'no-store' },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { volume14d: string };
    const scaled = Number(data.volume14d);
    if (!Number.isFinite(scaled) || scaled < 0) return null;
    return scaled / 10_000_000;
  } catch {
    return null;
  }
}
