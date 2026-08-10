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

  it('stats() returns stats and solvency', async () => {
    const { client, fake } = makeClient({
      scripts: [
        {
          status: 200,
          body: {
            stats: [
              {
                asset: 'BTC',
                openInterestLong: '1000000000',
                openInterestShort: '400000000',
                openInterestNet: '600000000',
                openPositions: 3,
                volume24h: '5000000000',
              },
            ],
            solvency: {
              cumulativeBadDebtCovered: '120',
              cumulativeBadDebtLpAbsorbed: '0',
              badDebtEvents: 1,
            },
          },
        },
      ],
    });
    const res = await client.markets.stats();
    expect(fake.calls[0]!.url).toBe('http://api.test/v1/markets/stats');
    expect(res.stats[0]!.openInterestNet).toBe('600000000');
    expect(res.stats[0]!.volume24h).toBe('5000000000');
    expect(res.solvency.cumulativeBadDebtCovered).toBe('120');
    expect(res.solvency.badDebtEvents).toBe(1);
  });

  it('candles() uppercases the asset and forwards interval and limit', async () => {
    const { client, fake } = makeClient({
      scripts: [
        {
          status: 200,
          body: {
            candles: [{ time: 1000, open: 1.1, high: 1.2, low: 1.0, close: 1.15 }],
            source: 'noeracle',
          },
        },
      ],
    });
    const res = await client.markets.candles('btc', { interval: '5m', limit: 10 });
    const url = new URL(fake.calls[0]!.url);
    expect(url.pathname).toBe('/v1/candles');
    expect(url.searchParams.get('asset')).toBe('BTC');
    expect(url.searchParams.get('interval')).toBe('5m');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(res.source).toBe('noeracle');
    expect(res.candles[0]!.close).toBe(1.15);
  });

  it('candles() omits optional params when not given', async () => {
    const { client, fake } = makeClient({
      scripts: [{ status: 200, body: { candles: [], source: 'binance' } }],
    });
    const res = await client.markets.candles('ETH');
    const url = new URL(fake.calls[0]!.url);
    expect([...url.searchParams.keys()]).toEqual(['asset']);
    expect(res.source).toBe('binance');
  });
});
