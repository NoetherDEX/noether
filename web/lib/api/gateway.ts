/**
 * "Can the gateway speak for OUR market?" — the guard behind trusting
 * indexer-backed reads as authoritative, INCLUDING their empty responses.
 *
 * GET /v1/health echoes (a) the market contract address the gateway actually
 * serves and (b) how stale the indexer cursor is. Trust requires BOTH:
 *
 *  - address match — on staging the shared gateway indexes the PRODUCTION
 *    market, so its "no rows for you" says nothing about the staging market.
 *    Without this check the staging trade page would render fake-empty
 *    positions/orders (the incident class the old fallback-on-empty guarded
 *    against).
 *  - freshness — a stalled indexer (the 5-week frozen-cursor incident) must
 *    demote the gateway back to a hint, never an authority. ledgerAgeSeconds
 *    is time since the cursor last advanced; the indexer polls every ~2s.
 *
 * The verdict is cached for 60s: at most one extra health fetch per minute,
 * and a stalled indexer flips trust off within a minute. Callers fall back
 * to direct chain scans whenever this returns false.
 */

import { apiBase } from './base';
import { CONTRACTS } from '@/lib/utils/constants';

const TRUST_TTL_MS = 60_000;
const MAX_INDEXER_LAG_SECONDS = 120;

interface HealthShape {
  contracts?: Record<string, { address?: string }>;
  indexer?: { ledgerAgeSeconds?: number | null };
}

let cached: { at: number; value: boolean } | null = null;

export async function gatewayServesThisMarket(): Promise<boolean> {
  const now = Date.now();
  if (cached && now - cached.at < TRUST_TTL_MS) return cached.value;

  let value = false;
  try {
    const res = await fetch(`${apiBase()}/v1/health`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.ok) {
      const health = (await res.json()) as HealthShape;
      const gatewayMarket = health.contracts?.market?.address ?? '';
      const lag = health.indexer?.ledgerAgeSeconds;
      value =
        Boolean(CONTRACTS.MARKET) &&
        gatewayMarket === CONTRACTS.MARKET &&
        typeof lag === 'number' &&
        lag <= MAX_INDEXER_LAG_SECONDS;
    }
  } catch {
    value = false; // unreachable/unconfigured gateway is never authoritative
  }
  cached = { at: now, value };
  return value;
}
