import { EventEmitter } from 'node:events';

/**
 * Internal WebSocket broadcast bus.
 *
 * Live data sources (oracle ticker, events tailer) emit on this bus.
 * The connection manager listens once per process and fans out to
 * subscribed clients. Channels are namespaced strings:
 *
 *   ticker.<asset>           — e.g. ticker.BTC
 *   trades.<asset>           — derived from position events
 *   events                   — firehose of all decoded events
 *   account.events.<address> — events_raw rows where trader=address
 *
 * Payloads are typed below. Keep them serialisable JSON (bigints stringified).
 */

export interface TickerPayload {
  asset: string;
  price: string;       // 7-decimal integer as string
  priceFloat: number;
  timestamp: number;   // unix seconds (oracle freshness)
  ts: number;          // unix ms (broadcast wall clock)
}

export interface TradePayload {
  kind: 'open' | 'close' | 'liquidation';
  asset: string;       // may be unknown for legacy events ('UNKNOWN')
  positionId: number;
  trader: string;
  price: string;
  pnl?: string;
  ledger: number;
  ts: number;
  txHash: string;
}

export interface EventPayload {
  topic: string;
  ledger: number;
  ledgerCloseTs: number;
  txHash: string;
  trader?: string;
  raw: Record<string, unknown>;
}

export interface AccountEventPayload extends EventPayload {
  /** The owner address this event was filtered for. */
  owner: string;
}

export interface WsBusMap {
  // Public
  [k: `ticker.${string}`]: TickerPayload;
  [k: `trades.${string}`]: TradePayload;
  events: EventPayload;
  // Authed (per-owner channel name embeds address)
  [k: `account.events.${string}`]: AccountEventPayload;
}

export class WsBus {
  private readonly inner = new EventEmitter();

  emit<C extends keyof WsBusMap & string>(channel: C, payload: WsBusMap[C]): void {
    this.inner.emit(channel, payload);
    this.inner.emit('*', channel, payload);
  }

  on<C extends keyof WsBusMap & string>(channel: C, handler: (payload: WsBusMap[C]) => void): () => void {
    this.inner.on(channel, handler as (...args: unknown[]) => void);
    return () => this.inner.off(channel, handler as (...args: unknown[]) => void);
  }

  /** Subscribe to *every* channel emission (for the connection manager fan-out). */
  onAny(handler: (channel: string, payload: unknown) => void): () => void {
    this.inner.on('*', handler as (...args: unknown[]) => void);
    return () => this.inner.off('*', handler as (...args: unknown[]) => void);
  }

  setMaxListeners(n: number): void {
    this.inner.setMaxListeners(n);
  }
}
