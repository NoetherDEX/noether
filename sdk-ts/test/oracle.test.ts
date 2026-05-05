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
});
