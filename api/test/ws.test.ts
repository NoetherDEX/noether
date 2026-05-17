import { describe, expect, it, afterEach } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { Keypair } from '@stellar/stellar-sdk';
import { setupTestServer, signChallengeXdr } from './helpers.js';

let cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const fn of cleanup) await fn().catch(() => undefined);
  cleanup = [];
});

async function bootApp() {
  const setup = await setupTestServer();
  const app = setup.app;
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  cleanup.push(() => app.close());
  return { app, db: setup.db, deps: setup.deps, address };
}

interface Mailbox {
  socket: WebSocket;
  next: () => Promise<unknown>;
  close: () => void;
}

function openMailbox(url: string): Promise<Mailbox> {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url);
    const queue: unknown[] = [];
    const waiters: Array<(v: unknown) => void> = [];
    sock.on('message', (data: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (waiters.length > 0) waiters.shift()!(parsed);
        else queue.push(parsed);
      } catch {
        // ignore
      }
    });
    sock.once('open', () =>
      resolve({
        socket: sock,
        next: () =>
          new Promise<unknown>((r) => {
            if (queue.length > 0) r(queue.shift());
            else waiters.push(r);
          }),
        close: () => sock.close(),
      }),
    );
    sock.once('error', reject);
  });
}

describe('/v1/ws', () => {
  it('sends hello on connect', async () => {
    const { address } = await bootApp();
    const mb = await openMailbox(`${address.replace('http', 'ws')}/v1/ws`);
    cleanup.push(async () => mb.close());
    const msg = (await mb.next()) as { type: string; ts: number };
    expect(msg.type).toBe('hello');
    expect(typeof msg.ts).toBe('number');
  });

  it('subscribes to ticker.BTC and receives a broadcast', async () => {
    const { address, deps } = await bootApp();
    const mb = await openMailbox(`${address.replace('http', 'ws')}/v1/ws`);
    cleanup.push(async () => mb.close());
    await mb.next(); // hello
    mb.socket.send(JSON.stringify({ op: 'subscribe', channels: ['ticker.BTC'] }));
    const ack = (await mb.next()) as { type: string; channels: string[] };
    expect(ack.type).toBe('subscribed');
    expect(ack.channels).toEqual(['ticker.BTC']);

    const tickPromise = mb.next();
    deps.wsBus.emit('ticker.BTC', {
      asset: 'BTC',
      price: '600000000000',
      priceFloat: 60_000,
      timestamp: 1,
      ts: 2,
    });
    const tick = (await tickPromise) as { channel: string; data: { asset: string } };
    expect(tick.channel).toBe('ticker.BTC');
    expect(tick.data.asset).toBe('BTC');
  });

  it('rejects unknown / unsupported asset channels', async () => {
    const { address } = await bootApp();
    const mb = await openMailbox(`${address.replace('http', 'ws')}/v1/ws`);
    cleanup.push(async () => mb.close());
    await mb.next();
    mb.socket.send(JSON.stringify({ op: 'subscribe', channels: ['ticker.DOGE', 'unknown'] }));
    const msg = (await mb.next()) as { type: string; channels: string[] };
    expect(msg.type).toBe('rejected');
    expect(msg.channels).toEqual(['ticker.DOGE', 'unknown']);
  });

  it('login + account.events.<owner> subscription works for matching owner', async () => {
    const { app, address } = await bootApp();
    // Issue a real key against the live app
    const kp = Keypair.random();
    const owner = kp.publicKey();
    const ch = await app.inject({ method: 'POST', url: '/v1/keys/challenge', payload: { address: owner } });
    const challenge = (ch.json() as { challengeHex: string }).challengeHex;
    const sig = signChallengeXdr(kp, challenge);
    const issued = await app.inject({
      method: 'POST', url: '/v1/keys',
      payload: { address: owner, challenge, signature: sig },
    });
    const { keyId, secret } = issued.json() as { keyId: string; secret: string };

    const mb = await openMailbox(`${address.replace('http', 'ws')}/v1/ws`);
    cleanup.push(async () => mb.close());
    await mb.next(); // hello

    mb.socket.send(JSON.stringify({ op: 'login', keyId, secret }));
    const loginAck = (await mb.next()) as { type: string; ok: boolean; owner: string };
    expect(loginAck.ok).toBe(true);
    expect(loginAck.owner).toBe(owner);

    const channel = `account.events.${owner}`;
    mb.socket.send(JSON.stringify({ op: 'subscribe', channels: [channel] }));
    const subAck = (await mb.next()) as { type: string; channels: string[] };
    expect(subAck.type).toBe('subscribed');
    expect(subAck.channels).toEqual([channel]);
  });

  it('rejects account.events.<other-owner> after login', async () => {
    const { app, address } = await bootApp();
    const kp = Keypair.random();
    const owner = kp.publicKey();
    const ch = await app.inject({ method: 'POST', url: '/v1/keys/challenge', payload: { address: owner } });
    const challenge = (ch.json() as { challengeHex: string }).challengeHex;
    const sig = signChallengeXdr(kp, challenge);
    const issued = await app.inject({
      method: 'POST', url: '/v1/keys',
      payload: { address: owner, challenge, signature: sig },
    });
    const { keyId, secret } = issued.json() as { keyId: string; secret: string };

    const mb = await openMailbox(`${address.replace('http', 'ws')}/v1/ws`);
    cleanup.push(async () => mb.close());
    await mb.next(); // hello
    mb.socket.send(JSON.stringify({ op: 'login', keyId, secret }));
    await mb.next(); // login ok

    const otherOwner = Keypair.random().publicKey();
    mb.socket.send(JSON.stringify({ op: 'subscribe', channels: [`account.events.${otherOwner}`] }));
    const msg = (await mb.next()) as { type: string };
    expect(msg.type).toBe('rejected');
  });

  it('ping → pong', async () => {
    const { address } = await bootApp();
    const mb = await openMailbox(`${address.replace('http', 'ws')}/v1/ws`);
    cleanup.push(async () => mb.close());
    await mb.next();
    mb.socket.send(JSON.stringify({ op: 'ping' }));
    const pong = (await mb.next()) as { type: string };
    expect(pong.type).toBe('pong');
  });
});

// ws is a transitive dep of @fastify/websocket — silence the "unused import" lint
// noop reference so the import isn't tree-shaken in a strict build.
void WebSocketServer;
