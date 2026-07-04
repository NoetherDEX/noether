/**
 * /v1/ws WebSocket endpoint.
 *
 * Protocol (JSON over text frames):
 *
 *   Client -> Server:
 *     { op:'subscribe', channels:[...] }
 *     { op:'unsubscribe', channels:[...] }
 *     { op:'login', keyId:'nk_...', secret:'...' }
 *     { op:'ping' }
 *
 *   Server -> Client:
 *     { type:'hello', ts }
 *     { type:'subscribed', channels }
 *     { type:'unsubscribed', channels }
 *     { type:'rejected', channels, reason? }
 *     { type:'login', ok:true, owner, tier }
 *     { type:'login', ok:false, error }
 *     { type:'pong', ts }
 *     { type:'error', error, detail? }
 *     { channel, data }
 */

import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import websocketPlugin from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import type { ApiKeyStore } from '../services/apiKeys.js';
import { WsManager, loginWithBearer, type WsConnection } from '../services/wsManager.js';

export interface WsPluginOpts {
  manager: WsManager;
  apiKeys: ApiKeyStore;
  /** When false, do not register the @fastify/websocket plugin (test override). */
  registerPlugin?: boolean;
}

interface ClientMessage {
  op?: string;
  channels?: unknown;
  keyId?: unknown;
  secret?: unknown;
}

async function impl(app: FastifyInstance, opts: WsPluginOpts): Promise<void> {
  if (opts.registerPlugin !== false) {
    await app.register(websocketPlugin);
  }

  app.get('/v1/ws', { websocket: true }, (socket, req) => {
    const id = randomUUID();
    const conn: WsConnection = {
      id,
      ip: req.ip,
      isAlive: true,
      subscriptions: new Set(),
      send: (msg: unknown) => socket.send(JSON.stringify(msg)),
      sendRaw: (data: string) => socket.send(data),
      ping: () => socket.ping(),
      bufferedAmount: () => socket.bufferedAmount,
      close: (code?: number, reason?: string) => socket.close(code, reason),
      terminate: () => socket.terminate(),
    };
    const reg = opts.manager.register(conn);
    if (!reg.ok) {
      req.log.warn({ connectionId: id, ip: req.ip, reason: reg.reason }, 'ws connection rejected');
      socket.close(reg.code ?? 1013, reg.reason ?? 'try again later');
      return;
    }
    req.log.info({ connectionId: id, ip: req.ip }, 'ws connected');
    conn.send({ type: 'hello', ts: Date.now() });

    // Heartbeat: a pong (auto-sent by compliant clients in response to the
    // manager's ping frames) marks the connection live for the next sweep.
    socket.on('pong', () => {
      conn.isAlive = true;
    });

    socket.on('message', (raw: Buffer) => {
      // Token-bucket gate; the manager closes the socket on abuse so we just
      // stop processing here.
      if (!opts.manager.allowMessage(id)) return;
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString('utf8')) as ClientMessage;
      } catch {
        conn.send({ type: 'error', error: 'invalid_json' });
        return;
      }
      void handleMessage(conn, msg, opts);
    });

    socket.on('close', () => {
      opts.manager.unregister(id);
      req.log.info({ connectionId: id }, 'ws closed');
    });

    socket.on('error', (err) => {
      req.log.warn({ connectionId: id, err }, 'ws error');
    });
  });
}

async function handleMessage(conn: WsConnection, msg: ClientMessage, opts: WsPluginOpts): Promise<void> {
  const op = typeof msg.op === 'string' ? msg.op : '';

  switch (op) {
    case 'ping':
      conn.send({ type: 'pong', ts: Date.now() });
      return;

    case 'subscribe': {
      const channels = pickChannels(msg.channels);
      if (!channels) return conn.send({ type: 'error', error: 'invalid_channels' });
      const result = opts.manager.subscribe(conn.id, channels);
      const accepted = channels.filter((c) => !result.rejected?.includes(c));
      if (accepted.length > 0) conn.send({ type: 'subscribed', channels: accepted });
      if (result.rejected && result.rejected.length > 0) {
        conn.send({ type: 'rejected', channels: result.rejected });
      }
      return;
    }

    case 'unsubscribe': {
      const channels = pickChannels(msg.channels);
      if (!channels) return conn.send({ type: 'error', error: 'invalid_channels' });
      opts.manager.unsubscribe(conn.id, channels);
      conn.send({ type: 'unsubscribed', channels });
      return;
    }

    case 'login': {
      const keyId = typeof msg.keyId === 'string' ? msg.keyId : null;
      const secret = typeof msg.secret === 'string' ? msg.secret : null;
      if (!keyId || !secret) return conn.send({ type: 'login', ok: false, error: 'missing_credentials' });
      const user = await loginWithBearer(opts.apiKeys, keyId, secret);
      if (!user) return conn.send({ type: 'login', ok: false, error: 'invalid_credentials' });
      opts.manager.setUser(conn.id, user);
      conn.send({ type: 'login', ok: true, owner: user.owner, tier: user.tier });
      return;
    }

    default:
      conn.send({ type: 'error', error: 'unknown_op', detail: op });
  }
}

function pickChannels(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || item.length > 200) return null;
    out.push(item);
  }
  return out;
}

export const wsPlugin = fp(impl, { name: 'noether-ws' });
