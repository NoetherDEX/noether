import { describe, expect, it, afterEach } from 'vitest';
import { setupTestServer } from './helpers.js';
import { SUPPORTED_ASSETS, SUPPORTED_ASSET_SYMBOLS } from '@noether/shared';

let app: Awaited<ReturnType<typeof setupTestServer>>['app'] | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

describe('markets routes', () => {
  it('GET /v1/markets returns all supported assets with oracle prices', async () => {
    const setup = await setupTestServer({
      oraclePrices: {
        BTC: [60_000_0000000n, 1745923200n],
        ETH: [3_000_0000000n, 1745923200n],
        XLM: [10_000_000n, 1745923200n],
      },
    });
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/markets' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.markets).toHaveLength(SUPPORTED_ASSETS.length);
    const symbols = body.markets.map((m: { asset: { symbol: string } }) => m.asset.symbol);
    expect(symbols).toEqual([...SUPPORTED_ASSET_SYMBOLS]);
    const btc = body.markets.find((m: { asset: { symbol: string } }) => m.asset.symbol === 'BTC');
    expect(btc.oracle.priceFloat).toBe(60_000);
    expect(btc.oracle.price).toBe('600000000000');
  });

  it('GET /v1/markets/:asset returns single market', async () => {
    const setup = await setupTestServer({
      oraclePrices: { BTC: [60_000_0000000n, 1745923200n] },
    });
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/markets/btc' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.asset.symbol).toBe('BTC');
    expect(body.oracle.priceFloat).toBe(60_000);
  });

  it('GET /v1/markets/:asset returns 404 for unknown asset', async () => {
    const setup = await setupTestServer({});
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/markets/PEPE' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe('Unknown asset');
  });
});
