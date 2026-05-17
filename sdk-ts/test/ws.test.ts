import { describe, expect, it, vi } from 'vitest';
import { WsClient } from '../src/index.js';

interface FakeWebSocket {
  url: string;
  sent: string[];
  readyState: number;
  onopen?: () => void;
  onmessage?: (ev: { data: string }) => void;
  onclose?: () => void;
  onerror?: (ev: unknown) => void;
  send: (data: string) => void;
  close: () => void;
}

class FakeWs implements FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWs[] = [];

  url: string;
  sent: string[] = [];
  readyState = 0;
  onopen?: () => void;
  onmessage?: (ev: { data: string }) => void;
  onclose?: () => void;
  onerror?: (ev: unknown) => void;

  constructor(url: string) {
    this.url = url;
    FakeWs.instances.push(this);
  }
  send(data: string): void { this.sent.push(data); }
  close(): void { this.readyState = FakeWs.CLOSED; this.onclose?.(); }

  // Test helpers
  open(): void { this.readyState = FakeWs.OPEN; this.onopen?.(); }
  recv(payload: unknown): void { this.onmessage?.({ data: JSON.stringify(payload) }); }
}

describe('WsClient', () => {
  it('connects, receives hello, then resolves connect()', async () => {
    FakeWs.instances = [];
    const client = new WsClient({ url: 'ws://test/v1/ws', WebSocket: FakeWs as unknown as typeof WebSocket });
    const promise = client.connect();
    const sock = FakeWs.instances[0]!;
    sock.open();
    sock.recv({ type: 'hello', ts: 1 });
    await promise;
    expect(client.isOpen()).toBe(true);
  });

  it('sends subscribe + relays broadcast to handler', async () => {
    FakeWs.instances = [];
    const client = new WsClient({ url: 'ws://test/v1/ws', WebSocket: FakeWs as unknown as typeof WebSocket });
    const ready = client.connect();
    const sock = FakeWs.instances[0]!;
    sock.open();
    sock.recv({ type: 'hello', ts: 1 });
    await ready;

    const handler = vi.fn();
    await client.subscribe('ticker.BTC', handler);
    expect(JSON.parse(sock.sent[0]!).op).toBe('subscribe');

    sock.recv({ channel: 'ticker.BTC', data: { asset: 'BTC', priceFloat: 60000 } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toEqual({ asset: 'BTC', priceFloat: 60000 });
    expect(handler.mock.calls[0]?.[1]).toBe('ticker.BTC');
  });

  it('logs in on connect when credentials are set', async () => {
    FakeWs.instances = [];
    const client = new WsClient({
      url: 'ws://test/v1/ws',
      credentials: { keyId: 'nk_x', secret: 's' },
      WebSocket: FakeWs as unknown as typeof WebSocket,
    });
    const ready = client.connect();
    const sock = FakeWs.instances[0]!;
    sock.open();
    sock.recv({ type: 'hello', ts: 1 });
    await ready;
    const loginMsg = sock.sent.map((s) => JSON.parse(s)).find((m) => m.op === 'login');
    expect(loginMsg).toEqual({ op: 'login', keyId: 'nk_x', secret: 's' });
  });

  it('re-subscribes on reconnect', async () => {
    FakeWs.instances = [];
    const client = new WsClient({
      url: 'ws://test/v1/ws',
      minBackoffMs: 1,
      WebSocket: FakeWs as unknown as typeof WebSocket,
    });
    const ready = client.connect();
    const sock1 = FakeWs.instances[0]!;
    sock1.open();
    sock1.recv({ type: 'hello', ts: 1 });
    await ready;
    await client.subscribe('trades.ETH', () => undefined);

    sock1.close();
    await new Promise((r) => setTimeout(r, 30)); // allow reconnect
    const sock2 = FakeWs.instances[1];
    expect(sock2).toBeDefined();
    sock2!.open();
    sock2!.recv({ type: 'hello', ts: 2 });
    // small wait for the "open" handler to flush re-subscribe
    await new Promise((r) => setTimeout(r, 5));

    const subMsgs = sock2!.sent.map((s) => JSON.parse(s)).filter((m) => m.op === 'subscribe');
    expect(subMsgs[0]?.channels).toEqual(['trades.ETH']);

    client.close();
  });

  it('ping sends a ping op', async () => {
    FakeWs.instances = [];
    const client = new WsClient({ url: 'ws://test/v1/ws', WebSocket: FakeWs as unknown as typeof WebSocket });
    const ready = client.connect();
    const sock = FakeWs.instances[0]!;
    sock.open();
    sock.recv({ type: 'hello', ts: 1 });
    await ready;
    client.ping();
    expect(JSON.parse(sock.sent.at(-1)!).op).toBe('ping');
  });
});
