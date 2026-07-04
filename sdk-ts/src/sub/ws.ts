/**
 * WebSocket sub-client.
 *
 * Auto-reconnects with exponential backoff (capped at 30s) and re-sends
 * any in-flight subscriptions + login on reconnect, so consumers can
 * subscribe once and forget about transient drops.
 *
 * connect() returns one promise per call: it resolves when any attempt
 * receives the server hello, and rejects on timeout (`connectTimeoutMs`),
 * on give-up (autoReconnect disabled) or on close() — it never hangs.
 * Because the gateway may process a subscribe before the login that
 * preceded it, `account.*` subscriptions are re-sent after every
 * successful login ack.
 */

import type { Credentials } from '../transport.js';

type WsCtor = typeof WebSocket;

export type ChannelHandler = (data: unknown, channel: string) => void;

const PRIVATE_CHANNEL_PREFIX = 'account.';

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
  /** Reject connect() if no attempt has received hello after this long (default 15_000). */
  connectTimeoutMs?: number;
  /** Fired when the server rejects one or more channel subscriptions. */
  onSubscriptionRejected?: (channels: string[], reason?: string) => void;
  /** Fired on every login ack — ok:false means the credentials were refused. */
  onLogin?: (ok: boolean, error?: string) => void;
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
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly WS: WsCtor;
  private readonly minBackoff: number;
  private readonly maxBackoff: number;
  private readonly autoReconnect: boolean;
  private readonly connectTimeoutMs: number;

  constructor(private readonly opts: WsClientOptions) {
    this.WS = opts.WebSocket ?? (globalThis.WebSocket as WsCtor | undefined) ?? throwNoWs();
    this.credentials = opts.credentials ?? null;
    this.minBackoff = opts.minBackoffMs ?? 250;
    this.maxBackoff = opts.maxBackoffMs ?? 30_000;
    this.autoReconnect = opts.autoReconnect ?? true;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 15_000;
  }

  /** Open the connection (idempotent). Resolves once the server's hello is received. */
  async connect(): Promise<void> {
    if (this.connectingPromise) return this.connectingPromise;
    return this.startCycle(true);
  }

  /**
   * Begin a connect cycle: one promise settled by whichever attempt gets
   * hello. Caller-initiated cycles time out after connectTimeoutMs;
   * background reconnect cycles retry forever under backoff.
   */
  private startCycle(withTimeout: boolean): Promise<void> {
    this.closed = false;
    this.connectingPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    if (withTimeout) {
      this.connectTimer = setTimeout(() => {
        const sock = this.socket;
        this.clearRetryTimer();
        this.settleConnect(new Error(`ws connect timed out after ${this.connectTimeoutMs}ms`));
        sock?.close();
      }, this.connectTimeoutMs);
    }
    this.attempt();
    return this.connectingPromise;
  }

  /** Stop reconnecting and close the socket. */
  close(): void {
    this.closed = true;
    this.clearRetryTimer();
    this.settleConnect(new Error('ws closed by client'));
    this.connectingPromise = null;
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

  private attempt(): void {
    if (this.closed) return;
    let established = false;

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
      let msg: { type?: string; channel?: string; channels?: unknown; data?: unknown; ok?: boolean; error?: string; reason?: string };
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        established = true;
        this.settleConnect(null);
        return;
      }
      if (msg.type === 'login') {
        const ok = msg.ok === true;
        if (ok) {
          // The gateway may have evaluated our subscribe before the
          // login finished — re-send private channels now that this
          // connection is authenticated.
          const priv = [...this.subs.keys()].filter((c) => c.startsWith(PRIVATE_CHANNEL_PREFIX));
          if (priv.length > 0) this.send({ op: 'subscribe', channels: priv });
        } else {
          this.opts.onLog?.('warn', 'ws login failed', msg);
        }
        this.opts.onLogin?.(ok, msg.error);
        return;
      }
      if (msg.type === 'rejected') {
        const channels = Array.isArray(msg.channels) ? (msg.channels as string[]) : [];
        this.opts.onLog?.('warn', 'ws subscriptions rejected', msg);
        this.opts.onSubscriptionRejected?.(channels, msg.reason);
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
      if (this.socket === sock) this.socket = null;
      this.opts.onLog?.('info', 'ws closed');
      const pending = this.readyReject !== null;
      if (this.closed) {
        if (pending) this.settleConnect(new Error('ws closed by client'));
        return;
      }
      if (pending) {
        // Still trying to satisfy an in-flight connect(): retry under
        // the same promise, or give up if reconnects are disabled.
        if (!this.autoReconnect) {
          this.settleConnect(new Error('ws connection failed'));
          return;
        }
        const delay = this.nextBackoff();
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          if (!this.closed && this.readyReject !== null) this.attempt();
        }, delay);
        return;
      }
      if (!established) return; // aborted by connect timeout — stay idle
      // An established connection dropped: start a fresh connect cycle
      // (no timeout — background reconnects keep retrying under backoff).
      this.connectingPromise = null;
      if (this.autoReconnect) {
        const delay = this.nextBackoff();
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          if (!this.closed && !this.connectingPromise) void this.startCycle(false).catch(() => {});
        }, delay);
      }
    };
  }

  /** Settle the pending connect() promise: resolve on null, reject on error. */
  private settleConnect(err: Error | null): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    const resolve = this.readyResolve;
    const reject = this.readyReject;
    this.readyResolve = null;
    this.readyReject = null;
    if (err) {
      this.connectingPromise = null;
      reject?.(err);
    } else {
      resolve?.();
    }
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private nextBackoff(): number {
    const delay = Math.min(this.maxBackoff, this.minBackoff * 2 ** this.reconnectAttempts);
    this.reconnectAttempts++;
    return delay;
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
