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
 * LEGACY (pre-Batch-1 router): the five price-related ScVal args the deployed
 * v1 router expects AFTER the trade args:
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

/**
 * Batch-1 router (L0-8 quorum ABI): every *_with_price entry point ends in
 * ONE `PriceAttestation` struct — the asset rides inside, and prices/pubkeys/
 * sigs are aligned per-publisher arrays (single-publisher here; the service
 * returns one signer per round). Soroban UDT structs travel as ScMaps with
 * entries SORTED BY KEY: asset < prices < pubkeys < round_id < sigs < timestamp
 * — a wrong order fails the on-chain decode.
 */
export function attestationStructArg(asset: string, att: Attestation): xdr.ScVal {
  const entry = (key: string, val: xdr.ScVal) =>
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
  return xdr.ScVal.scvMap([
    entry('asset', nativeToScVal(asset, { type: 'symbol' })),
    entry('prices', xdr.ScVal.scvVec([nativeToScVal(att.price, { type: 'i128' })])),
    entry('pubkeys', xdr.ScVal.scvVec([xdr.ScVal.scvBytes(Buffer.from(att.publisherHex, 'hex'))])),
    entry('round_id', nativeToScVal(BigInt(att.roundId), { type: 'u64' })),
    entry('sigs', xdr.ScVal.scvVec([xdr.ScVal.scvBytes(Buffer.from(att.signatureHex, 'hex'))])),
    entry('timestamp', nativeToScVal(BigInt(att.timestamp), { type: 'u64' })),
  ]);
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

/** No frame for this long → the stream is considered stale. */
const STALE_AFTER_MS = 10_000;
/** While stale, poll the on-chain shim price at this cadence. */
const SHIM_POLL_MS = 5_000;
/** Default read-only source account for shim price simulations. */
const READONLY_KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

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
 * Staleness: a watchdog tracks the last received frame. If none arrives for
 * ~10s (feed died, laptop woke from sleep, fatal socket close), `onStatus(true)`
 * fires and the on-chain shim price is polled every 5s and fed through `onPrice`
 * so marks/PnL keep moving. When frames resume, `onStatus(false)` fires and the
 * fallback poll stops. `readerKey` is the source account used for the read-only
 * shim simulations (pass the connected wallet; defaults to the shared
 * read-only key).
 *
 * This drives the real-time price DISPLAY. It does NOT replace the on-chain
 * read (`getPrice` via the shim) used where a transaction needs a verified price.
 */
export function subscribeLivePrices(
  assets: string[],
  onPrice: (p: LivePrice) => void,
  onStatus?: (stale: boolean) => void,
  readerKey?: string,
): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return () => {};
  }

  const wanted = new Set(assets.map((a) => `${a}/USD`));
  const es = new EventSource(`${NOERACLE_API_URL}/v1/stream`);

  const shimReader = readerKey || READONLY_KEY;
  let lastFrameAt = Date.now();
  let stale = false;
  let closed = false;
  let shimPoll: ReturnType<typeof setInterval> | null = null;

  // Lazy-import the shim reader so oracle.ts (module-level shim Contract)
  // only loads in the browser, and only if the fallback actually engages.
  const pollShim = async () => {
    try {
      const { getPrice, priceToDisplay } = await import('./oracle');
      await Promise.all(
        assets.map(async (asset) => {
          const priceData = await getPrice(shimReader, asset);
          // Only deliver if still stale — never overwrite a resumed live feed.
          if (priceData && stale && !closed) {
            onPrice({
              asset,
              price: priceToDisplay(priceData.price),
              timestamp: priceData.timestamp,
              roundId: 0,
            });
          }
        }),
      );
    } catch {
      // shim read unavailable — keep the stale flag up and retry next tick
    }
  };

  const setStale = (next: boolean) => {
    if (stale === next || closed) return;
    stale = next;
    onStatus?.(next);
    if (next) {
      pollShim();
      shimPoll = setInterval(pollShim, SHIM_POLL_MS);
    } else if (shimPoll) {
      clearInterval(shimPoll);
      shimPoll = null;
    }
  };

  const watchdog = setInterval(() => {
    if (Date.now() - lastFrameAt >= STALE_AFTER_MS) setStale(true);
  }, 2_000);

  const handlePrices = (ev: MessageEvent) => {
    try {
      const data = JSON.parse(ev.data) as { assets?: Record<string, StreamEntry> };
      lastFrameAt = Date.now();
      setStale(false);
      const map = data.assets ?? {};
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
  es.onerror = () => {
    // Transient drops auto-reconnect and are covered by the watchdog; a hard
    // close never recovers, so flag stale right away.
    if (es.readyState === EventSource.CLOSED) setStale(true);
  };

  return () => {
    closed = true;
    clearInterval(watchdog);
    if (shimPoll) clearInterval(shimPoll);
    es.removeEventListener('prices', handlePrices as EventListener);
    es.close();
  };
}
