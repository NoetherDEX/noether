import { xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { NOERACLE_API_URL } from '@/lib/utils/constants';

/**
 * Noeracle attestation reader for the router trade path.
 *
 * When the verify-then-trade router is enabled (NEXT_PUBLIC_NOETHER_ROUTER_ID),
 * the web fetches one freshly-signed price here at trade time and hands its raw
 * fields to `noether_router.open_with_price`. Uses a plain `fetch` against the
 * public attestation service — no `@noeracle/sdk` dependency, browser-native.
 */

/** One signed Noeracle attestation, decoded for building a router call. */
export interface Attestation {
  /** Integer price scaled by 1e7 (matches Noether's 7-decimal precision). */
  price: bigint;
  /** Unix seconds the round was signed. */
  timestamp: number;
  roundId: number;
  /** Publisher Ed25519 public key, 32-byte hex. */
  publisherHex: string;
  /** Ed25519 signature over the round, 64-byte hex. */
  signatureHex: string;
}

interface LatestEntry {
  price: string;
  timestamp: number;
  round_id: number;
  publisher: string;
  signature: string;
}

/**
 * Fetch the latest signed attestation for an asset ("BTC" / "ETH" / "XLM")
 * from the Noeracle attestation service. Returns null if unavailable so the
 * caller can fail the trade loudly rather than open on a missing price.
 */
export async function fetchAttestation(asset: string): Promise<Attestation | null> {
  try {
    const res = await fetch(`${NOERACLE_API_URL}/v1/latest`);
    if (!res.ok) return null;
    const body = (await res.json()) as { assets?: Record<string, LatestEntry> };
    const att = body.assets?.[`${asset}/USD`];
    if (!att) return null;
    return {
      price: BigInt(att.price),
      timestamp: Number(att.timestamp),
      roundId: Number(att.round_id),
      publisherHex: att.publisher,
      signatureHex: att.signature,
    };
  } catch {
    return null;
  }
}

/**
 * The five price-related ScVal args the router expects AFTER the trade args:
 * (price: i128, timestamp: u64, round_id: u64, pubkeys: Vec<BytesN<32>>, sigs: Vec<BytesN<64>>).
 * The router derives the 8-byte asset tag itself, so it is not passed here.
 */
export function priceTailArgs(att: Attestation): xdr.ScVal[] {
  return [
    nativeToScVal(att.price, { type: 'i128' }),
    nativeToScVal(BigInt(att.timestamp), { type: 'u64' }),
    nativeToScVal(BigInt(att.roundId), { type: 'u64' }),
    xdr.ScVal.scvVec([xdr.ScVal.scvBytes(Buffer.from(att.publisherHex, 'hex'))]),
    xdr.ScVal.scvVec([xdr.ScVal.scvBytes(Buffer.from(att.signatureHex, 'hex'))]),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Live 500ms price stream (Pattern C — SSE)
// ─────────────────────────────────────────────────────────────────────────────

/** A live, human-readable price for one asset, decoded from a stream round. */
export interface LivePrice {
  /** Asset symbol, e.g. "BTC". */
  asset: string;
  /** Human-readable price (USD). */
  price: number;
  /** Unix seconds the round was signed. */
  timestamp: number;
  roundId: number;
}

interface StreamEntry {
  price_human?: number;
  price: string;
  timestamp: number;
  round_id: number;
}

/** Health of the live price stream, surfaced to the UI. */
export type PriceStreamStatus = 'live' | 'stale' | 'connecting';

/** No live frame within this many ms ⇒ the stream is treated as stale. */
export const PRICE_STALE_MS = 4000;

/** Optional hooks for observing stream health (P0-9 / W-4). */
export interface SubscribeOptions {
  /** Fires whenever the stream's health changes (deduped). */
  onStatus?: (status: PriceStreamStatus) => void;
  /** Override the staleness window (default {@link PRICE_STALE_MS}). */
  staleMs?: number;
}

/**
 * Subscribe to Noeracle's live ~500ms price stream for the given assets.
 *
 * Uses the browser-native `EventSource` against the public SSE endpoint
 * (`/v1/stream`, CORS-open) — no `@noeracle/sdk` dependency. `onPrice` fires for
 * each requested asset on every round (every ~500ms on testnet). Returns an
 * unsubscribe function; call it on unmount. EventSource auto-reconnects on
 * transient errors. No-op on the server (returns a noop) so it's safe to call
 * from a client component's effect.
 *
 * This drives the real-time price DISPLAY. It does NOT replace the on-chain
 * read (`getPrice` via the shim) used where a transaction needs a verified price.
 *
 * `opts.onStatus` reports stream health: `live` while frames flow, `stale` when
 * none arrive within the watchdog window, `connecting` on transport error or
 * (re)connect. The browser auto-reconnects, so `connecting` is usually transient.
 */
export function subscribeLivePrices(
  assets: string[],
  onPrice: (p: LivePrice) => void,
  opts: SubscribeOptions = {},
): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return () => {};
  }

  const { onStatus, staleMs = PRICE_STALE_MS } = opts;

  const wanted = new Set(assets.map((a) => `${a}/USD`));
  const es = new EventSource(`${NOERACLE_API_URL}/v1/stream`);

  // Measure staleness from subscribe time so a connected-but-silent stream is
  // also caught, not just a dropped connection.
  let lastFrameAt = Date.now();
  // Start `null` (not `connecting`) so a resubscribe — e.g. the user switching
  // markets — doesn't briefly flash the staleness badge. Real gaps are surfaced
  // by `onerror` and the watchdog below; the consumer owns the initial state.
  let status: PriceStreamStatus | null = null;
  const report = (next: PriceStreamStatus) => {
    if (next !== status) {
      status = next;
      onStatus?.(next);
    }
  };

  const handlePrices = (ev: MessageEvent) => {
    try {
      const data = JSON.parse(ev.data) as { assets?: Record<string, StreamEntry> };
      const map = data.assets ?? {};
      lastFrameAt = Date.now();
      report('live');
      for (const pair of wanted) {
        const e = map[pair];
        if (!e) continue;
        const human = typeof e.price_human === 'number'
          ? e.price_human
          : Number(BigInt(e.price)) / 10_000_000;
        onPrice({
          asset: pair.replace('/USD', ''),
          price: human,
          timestamp: Number(e.timestamp),
          roundId: Number(e.round_id),
        });
      }
    } catch {
      // ignore a malformed frame; the next round arrives in ~500ms
    }
  };

  // The service tags its frames `event: prices`; also handle default messages.
  es.addEventListener('prices', handlePrices as EventListener);
  es.onmessage = handlePrices;
  // EventSource retries on its own; surface the gap so the UI can warn + fall back.
  es.onerror = () => report('connecting');

  // Last-frame watchdog: if rounds stop arriving, flip to `stale`.
  const watchdog = setInterval(() => {
    if (Date.now() - lastFrameAt > staleMs) report('stale');
  }, 1000);

  return () => {
    clearInterval(watchdog);
    es.removeEventListener('prices', handlePrices as EventListener);
    es.onerror = null;
    es.close();
  };
}
