import { describe, expect, it } from 'vitest';
import type { Logger } from 'pino';
import { WsBus } from '../src/services/wsBus.js';
import { WsManager, type WsConnection } from '../src/services/wsManager.js';

function noopLogger(): Logger {
  const noop = () => undefined;
  const logger = {
    level: 'silent',
    fatal: noop, error: noop, warn: noop, info: noop, debug: noop, trace: noop,
    silent: noop, child: () => logger,
  } as unknown as Logger;
  return logger;
}

interface FakeConn extends WsConnection {
  sent: string[];
  pings: number;
  terminated: boolean;
  closedWith: { code?: number; reason?: string } | null;
  buffered: number;
}

function fakeConn(id: string, ip = '10.0.0.1'): FakeConn {
  const conn: FakeConn = {
    id,
    ip,
    isAlive: true,
    subscriptions: new Set<string>(),
    sent: [],
    pings: 0,
    terminated: false,
    closedWith: null,
    buffered: 0,
    send: (msg: unknown) => conn.sent.push(JSON.stringify(msg)),
    sendRaw: (data: string) => conn.sent.push(data),
    ping: () => { conn.pings += 1; },
    bufferedAmount: () => conn.buffered,
    close: (code?: number, reason?: string) => { conn.closedWith = { code, reason }; },
    terminate: () => { conn.terminated = true; },
  };
  return conn;
}

function makeManager(opts?: ConstructorParameters<typeof WsManager>[2]) {
  const bus = new WsBus();
  return { mgr: new WsManager(bus, noopLogger(), opts), bus };
}

describe('WS hardening (A-5)', () => {
  describe('connection caps', () => {
    it('rejects with 1013 once the global cap is reached', () => {
      const { mgr } = makeManager({ maxConnections: 2, maxPerIp: 100 });
      expect(mgr.register(fakeConn('a', '1.1.1.1')).ok).toBe(true);
      expect(mgr.register(fakeConn('b', '2.2.2.2')).ok).toBe(true);
      const third = mgr.register(fakeConn('c', '3.3.3.3'));
      expect(third.ok).toBe(false);
      expect(third.code).toBe(1013);
      expect(mgr.size()).toBe(2);
    });

    it('rejects with 1013 once the per-IP cap is reached but admits other IPs', () => {
      const { mgr } = makeManager({ maxConnections: 100, maxPerIp: 2 });
      expect(mgr.register(fakeConn('a', '9.9.9.9')).ok).toBe(true);
      expect(mgr.register(fakeConn('b', '9.9.9.9')).ok).toBe(true);
      const third = mgr.register(fakeConn('c', '9.9.9.9'));
      expect(third.ok).toBe(false);
      expect(third.code).toBe(1013);
      // A different IP is still admitted.
      expect(mgr.register(fakeConn('d', '8.8.8.8')).ok).toBe(true);
    });

    it('frees per-IP slots on unregister', () => {
      const { mgr } = makeManager({ maxConnections: 100, maxPerIp: 1 });
      expect(mgr.register(fakeConn('a', '7.7.7.7')).ok).toBe(true);
      expect(mgr.register(fakeConn('b', '7.7.7.7')).ok).toBe(false);
      mgr.unregister('a');
      expect(mgr.register(fakeConn('c', '7.7.7.7')).ok).toBe(true);
    });
  });

  describe('heartbeat', () => {
    it('terminates a connection that misses a pong across two sweeps', () => {
      const { mgr } = makeManager();
      const conn = fakeConn('x');
      mgr.register(conn);

      // First sweep pings and marks the connection pending.
      mgr.pingSweep();
      expect(conn.pings).toBe(1);
      expect(conn.terminated).toBe(false);
      expect(conn.isAlive).toBe(false);

      // No pong arrived → second sweep terminates and drops it.
      mgr.pingSweep();
      expect(conn.terminated).toBe(true);
      expect(mgr.size()).toBe(0);
    });

    it('keeps a connection that ponged between sweeps', () => {
      const { mgr } = makeManager();
      const conn = fakeConn('x');
      mgr.register(conn);

      mgr.pingSweep();
      expect(conn.isAlive).toBe(false);
      // Simulate the pong the plugin would record.
      conn.isAlive = true;

      mgr.pingSweep();
      expect(conn.terminated).toBe(false);
      expect(conn.pings).toBe(2);
      expect(mgr.size()).toBe(1);
    });
  });

  describe('message rate limit', () => {
    it('allows a burst up to msgRate then closes the abuser with 1013', () => {
      const { mgr } = makeManager({ msgRate: 3 });
      const conn = fakeConn('r');
      mgr.register(conn);

      expect(mgr.allowMessage('r')).toBe(true);
      expect(mgr.allowMessage('r')).toBe(true);
      expect(mgr.allowMessage('r')).toBe(true);
      // Fourth message within the same second exhausts the bucket.
      expect(mgr.allowMessage('r')).toBe(false);
      expect(conn.closedWith?.code).toBe(1013);
      expect(mgr.size()).toBe(0);
      // The client is told why before the socket closes.
      expect(conn.sent.some((m) => m.includes('rate_limited'))).toBe(true);
    });
  });

  describe('broadcast fan-out', () => {
    it('serialises once per channel and delivers the same frame to every subscriber', () => {
      const { mgr, bus } = makeManager({ pingIntervalMs: 1_000_000 });
      mgr.attachBus();
      const a = fakeConn('a', '1.1.1.1');
      const b = fakeConn('b', '2.2.2.2');
      mgr.register(a);
      mgr.register(b);
      mgr.subscribe('a', ['ticker.BTC']);
      mgr.subscribe('b', ['ticker.BTC']);

      bus.emit('ticker.BTC', { asset: 'BTC', price: '1', priceFloat: 1, timestamp: 1, ts: 2 });

      expect(a.sent).toHaveLength(1);
      expect(b.sent).toHaveLength(1);
      expect(a.sent[0]).toBe(b.sent[0]);
      const frame = JSON.parse(a.sent[0]!) as { channel: string; data: { asset: string } };
      expect(frame.channel).toBe('ticker.BTC');
      expect(frame.data.asset).toBe('BTC');
      mgr.detachBus();
    });

    it('closes a slow consumer whose buffer exceeds the cap and spares the healthy one', () => {
      const { mgr, bus } = makeManager({ pingIntervalMs: 1_000_000, maxBufferedBytes: 1000 });
      mgr.attachBus();
      const fast = fakeConn('fast', '1.1.1.1');
      const slow = fakeConn('slow', '2.2.2.2');
      slow.buffered = 5000; // over the 1000-byte cap
      mgr.register(fast);
      mgr.register(slow);
      mgr.subscribe('fast', ['ticker.BTC']);
      mgr.subscribe('slow', ['ticker.BTC']);

      bus.emit('ticker.BTC', { asset: 'BTC', price: '1', priceFloat: 1, timestamp: 1, ts: 2 });

      expect(fast.sent).toHaveLength(1);
      expect(slow.sent).toHaveLength(0);
      expect(slow.closedWith?.code).toBe(1013);
      expect(mgr.size()).toBe(1);
      mgr.detachBus();
    });
  });
});
