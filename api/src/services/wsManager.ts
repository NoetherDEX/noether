/**
 * WebSocket connection + subscription state.
 *
 * Each open WS connection has:
 *   - a unique connectionId
 *   - a set of subscribed channels
 *   - an optional authenticated owner (after `login`)
 *
 * Authed channels (`account.events.*`) require login and bind to the
 * owner address, so a logged-in client can only subscribe to events
 * for its own address.
 */

import type { Logger } from 'pino';
import { isSupportedAsset } from '@noether/shared';
import type { ApiKeyStore, KeyTier } from './apiKeys.js';
import type { WsBus } from './wsBus.js';

export interface WsConnection {
  id: string;
  send: (msg: unknown) => void;
  close: (code?: number, reason?: string) => void;
  subscriptions: Set<string>;
  user?: { keyId: string; owner: string; tier: KeyTier };
}

export interface SubscribeResult {
  ok: boolean;
  rejected?: string[];
  reason?: string;
}

const ACCOUNT_PREFIX = 'account.events';

export class WsManager {
  private readonly connections = new Map<string, WsConnection>();
  private busOff: (() => void) | null = null;

  constructor(private readonly bus: WsBus, private readonly log: Logger) {}

  attachBus(): void {
    if (this.busOff) return;
    this.busOff = this.bus.onAny((channel, payload) => this.broadcast(channel, payload));
  }

  detachBus(): void {
    if (this.busOff) {
      this.busOff();
      this.busOff = null;
    }
  }

  register(conn: WsConnection): void {
    this.connections.set(conn.id, conn);
  }

  unregister(connectionId: string): void {
    this.connections.delete(connectionId);
  }

  size(): number {
    return this.connections.size;
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

  private broadcast(channel: string, payload: unknown): void {
    if (this.connections.size === 0) return;
    const message = { channel, data: payload };
    for (const conn of this.connections.values()) {
      if (conn.subscriptions.has(channel)) {
        try {
          conn.send(message);
        } catch (err) {
          this.log.warn({ err, connectionId: conn.id }, 'ws send failed');
        }
      }
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
