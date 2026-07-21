/**
 * Noether Keeper Bot — Stork Fast WS client + signed-payload parser (L0-8).
 *
 * Sources the raw `signed_ecdsa` payloads the router's `relay_stork`
 * entrypoint verifies on-chain. The CONTRACT is the verifier (secp256k1 /
 * keccak against the pinned signer, taxonomy, freshness, replay) — this
 * module only parses frames to sanity-check before paying relay fees and
 * to feed the off-chain publish-defense cross-validation (which replaces
 * the retired Core REST poll: our key has no Core entitlement).
 *
 * Wire facts (validated against production traffic 2026-07-18):
 * - Subscribe: `{"type":"subscribe","assets":[<u16 ids>]}` — NUMERIC ids
 *   in an `assets` field; string names and a `data` field are rejected.
 * - Frames arrive as JSON TEXT: `{"type":"signed_ecdsa","p":"0x<hex>"}`.
 * - Payload layout: sig(65: r32‖s32‖recovery 0/1) ‖ taxonomy u16 BE ‖
 *   timestamp_ns u64 BE ‖ N × (asset_id u16 BE ‖ value i128 BE, 1e18).
 *   ONE signature covers every asset in the frame.
 */

import WebSocket from 'ws';

/** Fast taxonomy id → market symbol (taxonomy 1). XLM has NO Fast feed
 *  (BD ask) — Reflector covers it; it can never be Stork-strict. Must
 *  mirror the router's `set_stork_assets` map. */
export const STORK_DEFAULT_ID_SYMBOLS: ReadonlyArray<readonly [number, string]> = [
  [3, 'BTC'],
  [4, 'ETH'],
  [6, 'ADA'],
  [11, 'BCH'],
  [12, 'BNB'],
  [14, 'DOGE'],
  [19, 'HYPE'],
  [21, 'LINK'],
  [22, 'LTC'],
  [32, 'TRX'],
  [38, 'XRP'],
  [39, 'ZEC'],
  [40, 'SOL'],
];

const HEADER_LEN = 65 + 2 + 8;
const ENTRY_LEN = 18;

export interface FastFrame {
  /** Full signed payload as bare hex (no 0x) — exactly what relay_stork takes. */
  payloadHex: string;
  taxonomy: number;
  timestampNs: bigint;
  /** asset_id → human USD price (1e18-descaled). Display/cross-val only. */
  entries: Map<number, number>;
  receivedAt: number;
}

/** The exact subscribe frame the Fast WS accepts. Pinned by the smoke suite. */
export function buildSubscribeMessage(assetIds: number[]): string {
  return JSON.stringify({ type: 'subscribe', assets: assetIds });
}

/** Parse one signed payload. Throws on malformed input — callers treat a
 *  throw as "not relayable", never as fatal. */
export function parseFastPayload(hex: string, receivedAt: number = Date.now()): FastFrame {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  const buf = Buffer.from(clean, 'hex');
  if (buf.length * 2 !== clean.length) throw new Error('payload is not valid hex');
  if (buf.length < HEADER_LEN + ENTRY_LEN || (buf.length - HEADER_LEN) % ENTRY_LEN !== 0) {
    throw new Error(`malformed payload length ${buf.length}`);
  }
  const taxonomy = buf.readUInt16BE(65);
  const timestampNs = buf.readBigUInt64BE(67);
  const entries = new Map<number, number>();
  for (let off = HEADER_LEN; off < buf.length; off += ENTRY_LEN) {
    const id = buf.readUInt16BE(off);
    entries.set(id, i128beToHuman(buf.subarray(off + 2, off + ENTRY_LEN)));
  }
  return { payloadHex: buf.toString('hex'), taxonomy, timestampNs, entries, receivedAt };
}

/** 16-byte big-endian i128 (1e18-scaled) → human number. Prices are always
 *  positive in practice; the sign branch exists so garbage can't wrap. */
function i128beToHuman(bytes: Buffer): number {
  let v = BigInt('0x' + bytes.toString('hex'));
  if (bytes[0] & 0x80) v -= 1n << 128n; // two's-complement negative
  return Number(v) / 1e18;
}

export interface StorkFastStatus {
  connected: boolean;
  lastFrameAt: number | null;
  reconnects: number;
  lastError: string | null;
}

export interface StorkFastOptions {
  wsUrl: string;
  apiKey: string;
  assetIds: number[];
  /** Fired for every parsed frame (cross-validation ingest). */
  onFrame?: (frame: FastFrame) => void;
}

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Persistent Fast WS subscription holding the newest signed frame in
 * memory. Never throws out of its callbacks; a dead feed just ages the
 * latest frame out (the relay loop and its watchdog handle alerting).
 */
export class StorkFastClient {
  private ws: WebSocket | null = null;
  private latestFrame: FastFrame | null = null;
  private lastFrameAt: number | null = null;
  private reconnects = 0;
  private reconnectDelay = RECONNECT_MIN_MS;
  private lastError: string | null = null;
  private stopped = false;

  constructor(private readonly opts: StorkFastOptions) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
    this.ws = null;
  }

  latest(): FastFrame | null {
    return this.latestFrame;
  }

  status(): StorkFastStatus {
    return {
      connected: this.ws?.readyState === WebSocket.OPEN,
      lastFrameAt: this.lastFrameAt,
      reconnects: this.reconnects,
      lastError: this.lastError,
    };
  }

  private connect(): void {
    if (this.stopped) return;
    try {
      const ws = new WebSocket(this.opts.wsUrl, {
        headers: { Authorization: `Basic ${this.opts.apiKey}` },
        handshakeTimeout: 10_000,
      });
      this.ws = ws;

      ws.on('open', () => {
        this.reconnectDelay = RECONNECT_MIN_MS;
        ws.send(buildSubscribeMessage(this.opts.assetIds));
      });

      ws.on('message', (data) => {
        try {
          const text = typeof data === 'string' ? data : data.toString();
          const msg = JSON.parse(text) as { type?: string; p?: string };
          if (msg.type !== 'signed_ecdsa' || typeof msg.p !== 'string') return;
          const frame = parseFastPayload(msg.p);
          this.latestFrame = frame;
          this.lastFrameAt = frame.receivedAt;
          this.lastError = null;
          this.opts.onFrame?.(frame);
        } catch (error) {
          // One bad frame is noise; the next arrives within the channel cadence.
          this.lastError = error instanceof Error ? error.message : String(error);
        }
      });

      ws.on('error', (error) => {
        this.lastError = error instanceof Error ? error.message : String(error);
      });

      ws.on('close', () => {
        this.ws = null;
        this.scheduleReconnect();
      });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnects++;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    setTimeout(() => this.connect(), delay).unref?.();
  }
}
