/**
 * WebSocket connection + subscription state.
 *
 * Each open WS connection has:
 *   - a unique connectionId
 *   - the originating IP (for per-IP connection caps)
 *   - a set of subscribed channels
 *   - an optional authenticated owner (after `login`)
 *
 * Authed channels (`account.events.*`) require login and bind to the
 * owner address, so a logged-in client can only subscribe to events
 * for its own address.
 *
 * The manager also enforces the abuse controls from audit A-5: global +
 * per-IP connection caps, a ping/idle heartbeat, a per-connection
 * token-bucket message rate limit, once-per-channel broadcast
 * serialisation, and bufferedAmount backpressure eviction.
 */

import type { Logger } from 'pino';
import { isSupportedAsset } from '@noether/shared';
import type { ApiKeyStore, KeyTier } from './apiKeys.js';
import type { WsBus } from './wsBus.js';

export interface WsConnection {
  id: string;
  ip: string;
  /** Heartbeat liveness flag — set true on pong, false when a ping is sent. */
  isAlive: boolean;
  send: (msg: unknown) => void;
  /** Send a pre-serialised frame (broadcast fan-out serialises once per channel). */
  sendRaw: (data: string) => void;
  ping: () => void;
  bufferedAmount: () => number;
  close: (code?: number, reason?: string) => void;
  terminate: () => void;
  subscriptions: Set<string>;
  user?: { keyId: string; owner: string; tier: KeyTier };
}

export interface WsManagerOptions {
  /** Max concurrent connections across the whole process. */
  maxConnections?: number;
  /** Max concurrent connections from a single IP. */
  maxPerIp?: number;
  /** Heartbeat sweep interval — a socket that misses one pong is terminated. */
  pingIntervalMs?: number;
  /** Token-bucket rate: sustained messages/sec and burst capacity per connection. */
  msgRate?: number;
  /** Close a subscriber whose socket buffer grows past this many bytes. */
  maxBufferedBytes?: number;
}

export interface RegisterResult {
  ok: boolean;
  /** Close code to use when ok is false (1013 = try again later). */
  code?: number;
  reason?: string;
}

export interface SubscribeResult {
  ok: boolean;
  rejected?: string[];
  reason?: string;
}

const ACCOUNT_PREFIX = 'account.events';

const DEFAULTS = {
  maxConnections: 1000,
  maxPerIp: 20,
  pingIntervalMs: 30_000,
  msgRate: 20,
  maxBufferedBytes: 1_048_576, // 1 MiB
};

interface RateState {
  tokens: number;
  last: number;
}

export class WsManager {
  private readonly connections = new Map<string, WsConnection>();
  private readonly perIp = new Map<string, number>();
  private readonly rate = new Map<string, RateState>();
  private busOff: (() => void) | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly maxConnections: number;
  private readonly maxPerIp: number;
  private readonly pingIntervalMs: number;
  private readonly msgRate: number;
  private readonly maxBufferedBytes: number;

  constructor(
    private readonly bus: WsBus,
    private readonly log: Logger,
    opts: WsManagerOptions = {},
  ) {
    this.maxConnections = opts.maxConnections ?? DEFAULTS.maxConnections;
    this.maxPerIp = opts.maxPerIp ?? DEFAULTS.maxPerIp;
    this.pingIntervalMs = opts.pingIntervalMs ?? DEFAULTS.pingIntervalMs;
    this.msgRate = opts.msgRate ?? DEFAULTS.msgRate;
    this.maxBufferedBytes = opts.maxBufferedBytes ?? DEFAULTS.maxBufferedBytes;
  }

  attachBus(): void {
    if (this.busOff) return;
    this.busOff = this.bus.onAny((channel, payload) => this.broadcast(channel, payload));
    this.startHeartbeat();
  }

  detachBus(): void {
    if (this.busOff) {
      this.busOff();
      this.busOff = null;
    }
    this.stopHeartbeat();
  }

  /**
   * Admit a new connection, enforcing the global and per-IP caps.
   * Returns { ok:false, code:1013 } when a cap is hit so the caller can
   * close the socket with a "try again later" status.
   */
  register(conn: WsConnection): RegisterResult {
    if (this.connections.size >= this.maxConnections) {
      return { ok: false, code: 1013, reason: 'server_full' };
    }
    const ipCount = this.perIp.get(conn.ip) ?? 0;
    if (ipCount >= this.maxPerIp) {
      return { ok: false, code: 1013, reason: 'too_many_connections' };
    }
    this.connections.set(conn.id, conn);
    this.perIp.set(conn.ip, ipCount + 1);
    this.rate.set(conn.id, { tokens: this.msgRate, last: Date.now() });
    return { ok: true };
  }

  unregister(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    this.connections.delete(connectionId);
    this.rate.delete(connectionId);
    const ipCount = this.perIp.get(conn.ip) ?? 0;
    if (ipCount <= 1) this.perIp.delete(conn.ip);
    else this.perIp.set(conn.ip, ipCount - 1);
  }

  size(): number {
    return this.connections.size;
  }

  /**
   * Per-connection token-bucket rate limit. Refills at `msgRate` tokens/sec
   * (burst capacity = msgRate). Returns false and closes the socket (1013)
   * once a connection blows its budget — a well-behaved client never trips
   * this. Returns false silently for an already-gone connection.
   */
  allowMessage(connectionId: string): boolean {
    const conn = this.connections.get(connectionId);
    const state = this.rate.get(connectionId);
    if (!conn || !state) return false;
    const now = Date.now();
    state.tokens = Math.min(this.msgRate, state.tokens + ((now - state.last) / 1000) * this.msgRate);
    state.last = now;
    if (state.tokens < 1) {
      this.log.warn({ connectionId, ip: conn.ip }, 'ws rate limit exceeded, closing');
      this.unregister(connectionId);
      try { conn.send({ type: 'error', error: 'rate_limited' }); } catch { /* ignore */ }
      try { conn.close(1013, 'rate limit exceeded'); } catch { /* ignore */ }
      return false;
    }
    state.tokens -= 1;
    return true;
  }

  subscribe(connectionId: string, channels: string[]): SubscribeResult {
    const conn = this.connections.get(connectionId);
    if (!conn) return { ok: false, reason: 'unknown_connection' };
    const rejected: string[] = [];
    for (const ch of channels) {
      if (!this.canSubscribe(conn, ch)) {
        rejected.push(ch);
        continue;
      }
      conn.subscriptions.add(ch);
    }
    return { ok: rejected.length === 0, rejected: rejected.length ? rejected : undefined };
  }

  unsubscribe(connectionId: string, channels: string[]): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    for (const ch of channels) conn.subscriptions.delete(ch);
  }

  setUser(connectionId: string, user: WsConnection['user']): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    conn.user = user;
  }

  /**
   * One heartbeat sweep: terminate connections that never ponged since the
   * previous sweep, then ping the survivors (marking them not-yet-alive
   * until the next pong). Public so tests can drive it deterministically.
   */
  pingSweep(): void {
    for (const conn of [...this.connections.values()]) {
      if (!conn.isAlive) {
        this.log.warn({ connectionId: conn.id }, 'ws heartbeat timeout, terminating');
        this.unregister(conn.id);
        try { conn.terminate(); } catch { /* ignore */ }
        continue;
      }
      conn.isAlive = false;
      try { conn.ping(); } catch { /* ignore */ }
    }
  }

  /**
   * Validate channel name + auth requirement.
   * Returns false to indicate rejection so the caller can surface a
   * structured error to the client.
   */
  private canSubscribe(conn: WsConnection, channel: string): boolean {
    if (channel === 'events') return true;
    if (channel.startsWith('ticker.')) {
      const asset = channel.slice('ticker.'.length);
      return isSupportedAsset(asset);
    }
    if (channel.startsWith('trades.')) {
      const asset = channel.slice('trades.'.length);
      return isSupportedAsset(asset);
    }
    if (channel.startsWith(`${ACCOUNT_PREFIX}.`)) {
      if (!conn.user) return false;
      const ownerInChannel = channel.slice(ACCOUNT_PREFIX.length + 1);
      return ownerInChannel === conn.user.owner;
    }
    return false;
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => this.pingSweep(), this.pingIntervalMs);
    this.heartbeat.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private broadcast(channel: string, payload: unknown): void {
    if (this.connections.size === 0) return;
    // Serialise once per channel rather than once per subscriber.
    let text: string | null = null;
    const slow: WsConnection[] = [];
    for (const conn of this.connections.values()) {
      if (!conn.subscriptions.has(channel)) continue;
      if (conn.bufferedAmount() > this.maxBufferedBytes) {
        slow.push(conn);
        continue;
      }
      if (text === null) text = JSON.stringify({ channel, data: payload });
      try {
        conn.sendRaw(text);
      } catch (err) {
        this.log.warn({ err, connectionId: conn.id }, 'ws send failed');
      }
    }
    // Evict slow consumers after the fan-out so we don't mutate the map mid-loop.
    for (const conn of slow) {
      this.log.warn({ connectionId: conn.id }, 'ws slow consumer over buffer, closing');
      this.unregister(conn.id);
      try { conn.close(1013, 'backpressure'); } catch { /* ignore */ }
    }
  }
}

export async function loginWithBearer(
  apiKeys: ApiKeyStore,
  keyId: string,
  secret: string,
): Promise<WsConnection['user'] | null> {
  const record = await apiKeys.lookupForAuth(keyId, secret);
  if (!record) return null;
  return { keyId: record.keyId, owner: record.owner, tier: record.tier };
}
