import { describe, expect, it } from 'vitest';
import { makeClient } from './helpers.js';

const CREDS = { credentials: { keyId: 'nk_x', secret: 'shh' } };

const EVENT = {
  eventId: 'ev1',
  contractId: 'C123',
  topic: 'position_opened',
  ledger: 100,
  ledgerCloseTs: 1_784_000_000,
  txHash: 'cafe',
  payload: { positionId: 12 },
  insertedAt: 1_784_000_001,
};

const POSITION = {
  positionId: 12,
  trader: 'GABC',
  asset: 'BTC',
  direction: 0,
  size: '1000000000',
  entryPrice: '600000000000',
  openedAt: 100,
  openedTxHash: 'cafe',
};

describe('account sub client', () => {
  it('positions() returns the full { positions, events } route shape', async () => {
    const { client, fake } = makeClient({
      ...CREDS,
      scripts: [{ status: 200, body: { positions: [POSITION], events: [EVENT] } }],
    });
    const res = await client.account.positions();
    expect(new URL(fake.calls[0]!.url).pathname).toBe('/v1/account/me/positions');
    // Both halves of the response survive; the events only shape is gone.
    expect(res.positions).toHaveLength(1);
    expect(res.positions[0]!.entryPrice).toBe('600000000000');
    expect(res.events).toHaveLength(1);
    expect(res.events[0]!.topic).toBe('position_opened');
  });

  it('events() forwards topic, beforeTs and limit', async () => {
    const { client, fake } = makeClient({
      ...CREDS,
      scripts: [{ status: 200, body: { events: [] } }],
    });
    await client.account.events({ topic: 'position_closed', beforeTs: 1_784_000_000, limit: 10 });
    const url = new URL(fake.calls[0]!.url);
    expect(url.pathname).toBe('/v1/account/me/events');
    expect(url.searchParams.get('topic')).toBe('position_closed');
    expect(url.searchParams.get('before_ts')).toBe('1784000000');
    expect(url.searchParams.get('limit')).toBe('10');
  });

  it('orders() forwards the beforeTs cursor and limit', async () => {
    const { client, fake } = makeClient({
      ...CREDS,
      scripts: [{ status: 200, body: { events: [] } }],
    });
    await client.account.orders({ beforeTs: 1_784_000_000, limit: 5 });
    const url = new URL(fake.calls[0]!.url);
    expect(url.pathname).toBe('/v1/account/me/orders');
    expect(url.searchParams.get('before_ts')).toBe('1784000000');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('orders() with no cursor sends no query params', async () => {
    const { client, fake } = makeClient({
      ...CREDS,
      scripts: [{ status: 200, body: { events: [] } }],
    });
    await client.account.orders();
    expect([...new URL(fake.calls[0]!.url).searchParams.keys()]).toEqual([]);
  });

  it('volume() is public and forwards the address', async () => {
    const { client, fake } = makeClient({
      scripts: [{ status: 200, body: { address: 'GABC', volume14d: '123450000000' } }],
    });
    const res = await client.account.volume('GABC');
    const url = new URL(fake.calls[0]!.url);
    expect(url.pathname).toBe('/v1/account/volume');
    expect(url.searchParams.get('address')).toBe('GABC');
    const headers = (fake.calls[0]!.init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(res.volume14d).toBe('123450000000');
  });

  it('shortfall() is public and returns the supported flag', async () => {
    const { client, fake } = makeClient({
      scripts: [
        { status: 200, body: { address: 'GABC', owed: '0', reserve: '0', supported: false } },
      ],
    });
    const res = await client.account.shortfall('GABC');
    const url = new URL(fake.calls[0]!.url);
    expect(url.pathname).toBe('/v1/account/shortfall');
    expect(url.searchParams.get('address')).toBe('GABC');
    // supported false means the zeros are placeholders, not facts.
    expect(res.supported).toBe(false);
    expect(res.owed).toBe('0');
  });

  it('positions() still requires credentials', async () => {
    const { client } = makeClient();
    await expect(client.account.positions()).rejects.toThrow(/authenticated/);
  });
});
