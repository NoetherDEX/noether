/**
 * Noether Keeper Bot — Stork secondary oracle (T3-D1 / W3)
 *
 * Second independent price source next to Noeracle. One REST call per
 * oracle cycle fetches ALL pairs from Stork's aggregated Core feed
 * (`GET /v1/prices/latest?assets=BTCUSD,…` — a single request for every
 * asset, far under Stork's universal 5 req/s limit).
 *
 * FAIL-OPEN BY DESIGN: without STORK_API_KEY, or while Stork is
 * unreachable or its cache has aged out, every lookup reports "no data"
 * and the keeper behaves exactly as before (Noeracle + Binance reference
 * only) — Stork being down must never stall the oracle. An AVAILABLE and
 * strongly-divergent Stork, however, is a halt signal the caller acts on:
 * two independent sources disagreeing is how a compromised feed looks.
 *
 * Stork prices are quantized to 10^18 (docs: "quantized value"); the
 * parser also accepts an already-human price defensively since the exact
 * REST envelope isn't publicly pinned — values above 1e9 are treated as
 * 1e18-scaled (smallest plausible scaled price ≈ 1e17 for a $0.10 asset;
 * largest plausible human price ≪ 1e9).
 */

const STORK_FETCH_TIMEOUT_MS = 5_000;

interface StorkEntry {
  price: number;
  fetchedAt: number;
}

const cache = new Map<string, StorkEntry>();
let consecutiveFailures = 0;
let lastSuccessAt = 0;
let lastErrorMessage = '';

/** Minimal slice of KeeperConfig this module needs. */
export interface StorkConfig {
  storkApiKey: string;
  storkRestUrl: string;
}

export function storkEnabled(config: StorkConfig): boolean {
  return config.storkApiKey.length > 0;
}

/**
 * Refresh the module cache with one batched fetch for all `symbols`
 * (base symbols, e.g. "BTC"). Never throws; a failure just leaves the
 * cache aging toward "no data".
 */
export async function refreshStorkPrices(config: StorkConfig, symbols: string[]): Promise<void> {
  if (!storkEnabled(config)) return;

  const assets = symbols.map((s) => `${s}USD`).join(',');
  try {
    const response = await fetch(
      `${config.storkRestUrl}/v1/prices/latest?assets=${assets}`,
      {
        headers: { Authorization: `Basic ${config.storkApiKey}` },
        signal: AbortSignal.timeout(STORK_FETCH_TIMEOUT_MS),
      },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { data?: Record<string, unknown> };

    const now = Date.now();
    let parsed = 0;
    for (const [key, value] of Object.entries(body?.data ?? {})) {
      const price = parseStorkPrice(value);
      if (price === null) continue;
      cache.set(key.replace(/USD$/, ''), { price, fetchedAt: now });
      parsed++;
    }
    if (parsed === 0) throw new Error('no parseable prices in response');

    consecutiveFailures = 0;
    lastSuccessAt = now;
    lastErrorMessage = '';
  } catch (error) {
    consecutiveFailures++;
    lastErrorMessage = error instanceof Error ? error.message : String(error);
    // Log-only: fail-open is the contract. Prolonged outage surfaces via
    // getStorkStatus() (health endpoint) and the aging cache.
    console.warn(`⚠️  Stork fetch failed (${consecutiveFailures}x): ${lastErrorMessage}`);
  }
}

/**
 * Last known Stork price for a base symbol, or null when disabled, never
 * fetched, or older than `maxAgeMs` (stale data must not veto pushes).
 */
export function getStorkPrice(symbol: string, maxAgeMs: number): number | null {
  const entry = cache.get(symbol);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > maxAgeMs) return null;
  return entry.price;
}

/** Per-source status snapshot (consumed by the oracle health surface). */
export function getStorkStatus(config: StorkConfig): {
  enabled: boolean;
  lastSuccessAt: number | null;
  consecutiveFailures: number;
  lastError: string | null;
  prices: Record<string, { price: number; ageMs: number }>;
} {
  const prices: Record<string, { price: number; ageMs: number }> = {};
  const now = Date.now();
  for (const [symbol, entry] of cache) {
    prices[symbol] = { price: entry.price, ageMs: now - entry.fetchedAt };
  }
  return {
    enabled: storkEnabled(config),
    lastSuccessAt: lastSuccessAt || null,
    consecutiveFailures,
    lastError: lastErrorMessage || null,
    prices,
  };
}

function parseStorkPrice(value: unknown): number | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as { price?: unknown; stork_signed_price?: { price?: unknown } };
  const raw = v.price ?? v.stork_signed_price?.price;
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
  if (!isFinite(n) || n <= 0) return null;
  return n > 1e9 ? n / 1e18 : n;
}

/** Test hook: reset module state. */
export function clearStorkCache(): void {
  cache.clear();
  consecutiveFailures = 0;
  lastSuccessAt = 0;
  lastErrorMessage = '';
}
