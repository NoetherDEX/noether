import { describe, expect, it } from 'vitest';
import { makeClient } from './helpers.js';

describe('events sub-client', () => {
  it('list() forwards filter params', async () => {
    const { client, fake } = makeClient({
      scripts: [{ status: 200, body: { events: [] } }],
    });
    await client.events.list({ topic: 'position_opened', fromLedger: 100, toLedger: 200, limit: 50 });
    const url = new URL(fake.calls[0]!.url);
    expect(url.pathname).toBe('/v1/events');
    expect(url.searchParams.get('topic')).toBe('position_opened');
    expect(url.searchParams.get('from_ledger')).toBe('100');
    expect(url.searchParams.get('to_ledger')).toBe('200');
    expect(url.searchParams.get('limit')).toBe('50');
  });

  it('list() forwards the beforeTs cursor as before_ts', async () => {
    const { client, fake } = makeClient({
      scripts: [{ status: 200, body: { events: [] } }],
    });
    await client.events.list({ beforeTs: 1_784_000_000, limit: 20 });
    const url = new URL(fake.calls[0]!.url);
    expect(url.searchParams.get('before_ts')).toBe('1784000000');
    expect(url.searchParams.get('limit')).toBe('20');
  });

  it('list() omits undefined filters', async () => {
    const { client, fake } = makeClient({
      scripts: [{ status: 200, body: { events: [] } }],
    });
    await client.events.list();
    const url = new URL(fake.calls[0]!.url);
    expect([...url.searchParams.keys()]).toEqual([]);
  });
});
