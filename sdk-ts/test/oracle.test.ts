import { describe, expect, it } from 'vitest';
import { makeClient } from './helpers.js';

describe('oracle sub-client', () => {
  it('getPrice returns one snapshot', async () => {
    const { client, fake } = makeClient({
      scripts: [{ status: 200, body: { asset: 'ETH', price: '20000000000', priceFloat: 2000, timestamp: 99 } }],
    });
    const p = await client.oracle.getPrice('eth');
    expect(p.asset).toBe('ETH');
    expect(p.priceFloat).toBe(2000);
    expect(fake.calls[0]!.url).toBe('http://api.test/v1/markets/ETH/price');
  });

  it('getPrices returns array', async () => {
    const { client } = makeClient({
      scripts: [{ status: 200, body: { prices: [{ asset: 'BTC', price: '0', priceFloat: 0, timestamp: 0 }] } }],
    });
    const ps = await client.oracle.getPrices();
    expect(ps).toHaveLength(1);
  });

  it('health() returns the full per source report', async () => {
    const { client, fake } = makeClient({
      scripts: [
        {
          status: 200,
          body: {
            status: 'degraded',
            onchain: {
              staleAfterSec: 60,
              staleCount: 1,
              assets: [
                { asset: 'BTC', priceFloat: 60000, ageSec: 5, stale: false, error: null },
                { asset: 'ETH', priceFloat: null, ageSec: null, stale: true, error: 'read failed' },
              ],
            },
            keeper: { configured: true, ageMs: 12000, stale: false, lastReport: { cycle: 42 } },
          },
        },
      ],
    });
    const health = await client.oracle.health();
    expect(fake.calls[0]!.url).toBe('http://api.test/v1/oracle/health');
    expect(health.status).toBe('degraded');
    expect(health.onchain.staleAfterSec).toBe(60);
    expect(health.onchain.assets).toHaveLength(2);
    expect(health.onchain.assets[1]!.stale).toBe(true);
    expect(health.keeper.configured).toBe(true);
    expect(health.keeper.lastReport).toEqual({ cycle: 42 });
  });
});
