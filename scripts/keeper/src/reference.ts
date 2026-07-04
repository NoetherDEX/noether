/**
 * Noether Keeper Bot - Independent Reference Ticker (K-2)
 *
 * Before publishing an attestation the keeper compares it against ONE
 * independent public ticker (Binance spot by default). Large divergence
 * means either the upstream attestation service or the reference has gone
 * bad — the push is skipped for that asset this cycle and an alert fires.
 *
 * Availability over paranoia: when the reference is UNREACHABLE the push
 * proceeds anyway (logged) — a Binance outage must not stall the oracle.
 *
 * Responses are cached for 30s so the check adds at most one HTTP call
 * per asset per push interval; failures are cached briefly (10s) to avoid
 * hammering a dead endpoint.
 */

const REFERENCE_FETCH_TIMEOUT_MS = 5_000;
const SUCCESS_CACHE_TTL_MS = 30_000;
const FAILURE_CACHE_TTL_MS = 10_000;

interface CacheEntry {
  price: number | null;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Fetch the reference USD price for a base symbol (e.g. "BTC" → BTCUSDT).
 * Returns null when the reference is unreachable or returns garbage —
 * the caller decides what "unavailable" means (push anyway + log).
 */
export async function getReferencePrice(baseUrl: string, symbol: string): Promise<number | null> {
  const now = Date.now();
  const cached = cache.get(symbol);
  if (cached) {
    const ttl = cached.price === null ? FAILURE_CACHE_TTL_MS : SUCCESS_CACHE_TTL_MS;
    if (now - cached.fetchedAt < ttl) return cached.price;
  }

  let price: number | null = null;
  try {
    const separator = baseUrl.includes('?') ? '&' : '?';
    const response = await fetch(`${baseUrl}${separator}symbol=${symbol}USDT`, {
      signal: AbortSignal.timeout(REFERENCE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { price?: string | number };
    const parsed = Number(body?.price);
    if (isFinite(parsed) && parsed > 0) price = parsed;
  } catch {
    price = null;
  }

  cache.set(symbol, { price, fetchedAt: now });
  return price;
}

/** Test hook: clear the reference cache. */
export function clearReferenceCache(): void {
  cache.clear();
}
