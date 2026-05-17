import { describe, expect, it } from 'vitest';
import { makeClient } from './helpers.js';

describe('markets sub-client', () => {
  it('list() returns markets array', async () => {
    const { client, fake } = makeClient({
      scripts: [
        {
          status: 200,
          body: {
            markets: [
              { asset: { symbol: 'BTC', name: 'Bitcoin', decimals: 8 }, oracle: { asset: 'BTC', price: '600000000000', priceFloat: 60000, timestamp: 1 } },
            ],
          },
        },
      ],
    });
    const markets = await client.markets.list();
    expect(markets).toHaveLength(1);
    expect(markets[0]!.asset.symbol).toBe('BTC');
    expect(fake.calls[0]!.url).toBe('http://api.test/v1/markets');
    expect(fake.calls[0]!.init?.method ?? 'GET').toBe('GET');
  });

  it('get(asset) uppercases', async () => {
    const { client, fake } = makeClient({
      scripts: [{ status: 200, body: { asset: { symbol: 'BTC', name: 'Bitcoin', decimals: 8 }, oracle: { asset: 'BTC', price: '0', priceFloat: 0, timestamp: 0 } } }],
    });
    await client.markets.get('btc');
    expect(fake.calls[0]!.url).toBe('http://api.test/v1/markets/BTC');
  });
});
