/**
 * WebSocket sub-client.
 *
 * Auto-reconnects with exponential backoff (capped at 30s) and re-sends
 * any in-flight subscriptions + login on reconnect, so consumers can
 * subscribe once and forget about transient drops.
 */

import type { Credentials } from '../transport.js';

type WsCtor = typeof WebSocket;

export type ChannelHandler = (data: unknown, channel: string) => void;

export interface WsClientOptions {
  /** ws:// / wss:// URL of the gateway WebSocket endpoint (e.g. wss://api/v1/ws). */
  url: string;
  /** Credentials to login with on every (re)connect. Optional. */
  credentials?: Credentials;
  /** Override the WebSocket constructor (Node 22+ has native global; tests inject a fake). */
  WebSocket?: WsCtor;
  /** Min reconnect delay in ms (default 250). */
  minBackoffMs?: number;
  /** Max reconnect delay in ms (default 30_000). */
  maxBackoffMs?: number;
  /** Auto-reconnect on close. Default true. */
  autoReconnect?: boolean;
  /** Optional logger for connection events. */
  onLog?: (level: 'info' | 'warn', msg: string, ctx?: unknown) => void;
}

interface ChannelSubscription {
  handler: ChannelHandler;
}

export class WsClient {
  private socket: WebSocket | null = null;
  private readonly subs = new Map<string, ChannelSubscription>();
  private credentials: Credentials | null = null;
  private closed = false;
  private reconnectAttempts = 0;
  private connectingPromise: Promise<void> | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;

  private readonly WS: WsCtor;
  private readonly minBackoff: number;
  private readonly maxBackoff: number;
  private readonly autoReconnect: boolean;

  constructor(private readonly opts: WsClientOptions) {
    this.WS = opts.WebSocket ?? (globalThis.WebSocket as WsCtor | undefined) ?? throwNoWs();
    this.credentials = opts.credentials ?? null;
    this.minBackoff = opts.minBackoffMs ?? 250;
    this.maxBackoff = opts.maxBackoffMs ?? 30_000;
    this.autoReconnect = opts.autoReconnect ?? true;
  }

  /** Open the connection (idempotent). Resolves once the server's hello is received. */
  async connect(): Promise<void> {
    if (this.connectingPromise) return this.connectingPromise;
    this.connectingPromise = this.doConnect();
    return this.connectingPromise;
  }

  /** Stop reconnecting and close the socket. */
  close(): void {
    this.closed = true;
    if (this.socket) this.socket.close();
    this.socket = null;
  }

  /** Subscribe to a channel; the handler fires for every server broadcast on that channel. */
  async subscribe(channel: string, handler: ChannelHandler): Promise<void> {
    this.subs.set(channel, { handler });
    if (this.isOpen()) this.send({ op: 'subscribe', channels: [channel] });
  }

  /** Remove a subscription. Tells the server to stop broadcasting on it. */
  async unsubscribe(channel: string): Promise<void> {
    this.subs.delete(channel);
    if (this.isOpen()) this.send({ op: 'unsubscribe', channels: [channel] });
  }

  /** Send a ping; server replies with `{type:"pong"}` (no return value). */
  ping(): void {
    if (this.isOpen()) this.send({ op: 'ping' });
  }

  /** Replace credentials; takes effect on next reconnect (or immediately via re-login). */
  setCredentials(creds: Credentials | null): void {
    this.credentials = creds;
    if (this.isOpen() && creds) {
      this.send({ op: 'login', keyId: creds.keyId, secret: creds.secret });
    }
  }

  isOpen(): boolean {
    return this.socket !== null && this.socket.readyState === this.WS.OPEN;
  }

  private async doConnect(): Promise<void> {
    if (this.closed) return;
    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });

    const sock = new this.WS(this.opts.url);
    this.socket = sock;
    sock.onopen = () => {
      this.opts.onLog?.('info', 'ws open');
      this.reconnectAttempts = 0;
      // Re-establish state on every (re)connect.
      if (this.credentials) {
        this.send({ op: 'login', keyId: this.credentials.keyId, secret: this.credentials.secret });
      }
      const channels = [...this.subs.keys()];
      if (channels.length > 0) this.send({ op: 'subscribe', channels });
    };
    sock.onmessage = (ev: MessageEvent) => {
      const text = typeof ev.data === 'string' ? ev.data : ev.data.toString();
      let msg: { type?: string; channel?: string; data?: unknown };
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        if (this.readyResolve) {
          this.readyResolve();
          this.readyResolve = null;
        }
        return;
      }
      if (msg.channel && this.subs.has(msg.channel)) {
        this.subs.get(msg.channel)!.handler(msg.data, msg.channel);
      }
    };
    sock.onerror = (ev: Event) => {
      this.opts.onLog?.('warn', 'ws error', ev);
    };
    sock.onclose = () => {
      this.socket = null;
      this.connectingPromise = null;
      this.opts.onLog?.('info', 'ws closed');
      if (!this.closed && this.autoReconnect) {
        const delay = Math.min(this.maxBackoff, this.minBackoff * 2 ** this.reconnectAttempts);
        this.reconnectAttempts++;
        setTimeout(() => {
          if (!this.closed) void this.connect();
        }, delay);
      }
    };

    await this.readyPromise;
  }

  private send(payload: unknown): void {
    this.socket?.send(JSON.stringify(payload));
  }
}

function throwNoWs(): never {
  throw new Error(
    'global WebSocket not available; pass `WebSocket` in WsClient options (Node 22+ has it; on older Node use the `ws` package: import WebSocket from "ws").',
  );
}
