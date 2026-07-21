/**
 * Noether Keeper Bot — Stork secondary oracle (T3-D1 / W3, Fast-fed since L0-8)
 *
 * Second independent price source next to Noeracle. Since the relay_stork
 * wiring, the cache is FED BY the Fast WS frames (storkFast.ts) via
 * `ingestStorkPrice` — the old Core REST poll is retired (our key has no
 * Core entitlement, so that path could only ever 401).
 *
 * FAIL-OPEN BY DESIGN: without STORK_API_KEY, or while the feed is dark
 * and the cache has aged out, every lookup reports "no data" and the
 * keeper behaves exactly as before (Noeracle + Binance reference only) —
 * Stork being down must never stall the oracle. An AVAILABLE and
 * strongly-divergent Stork, however, is a halt signal the caller acts on:
 * two independent sources disagreeing is how a compromised feed looks.
 */

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
}

export function storkEnabled(config: StorkConfig): boolean {
  return config.storkApiKey.length > 0;
}

/**
 * Feed one price into the cache (Fast WS push path). Never throws;
 * garbage values are dropped.
 */
export function ingestStorkPrice(symbol: string, price: number, at: number = Date.now()): void {
  if (!isFinite(price) || price <= 0) return;
  cache.set(symbol, { price, fetchedAt: at });
  consecutiveFailures = 0;
  lastSuccessAt = at;
  lastErrorMessage = '';
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

/** Test hook: reset module state. */
export function clearStorkCache(): void {
  cache.clear();
  consecutiveFailures = 0;
  lastSuccessAt = 0;
  lastErrorMessage = '';
}
