import { describe, expect, it, afterEach } from 'vitest';
import { setupTestServer } from './helpers.js';
import { SUPPORTED_ASSETS } from '@noether/shared';

let app: Awaited<ReturnType<typeof setupTestServer>>['app'] | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

describe('oracle routes', () => {
  it('GET /v1/oracle/prices returns all supported asset prices', async () => {
    const setup = await setupTestServer({
      oraclePrices: {
        BTC: [60_000_0000000n, 1n],
        ETH: [3_000_0000000n, 2n],
        XLM: [10_000_000n, 3n],
      },
    });
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/oracle/prices' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.prices).toHaveLength(SUPPORTED_ASSETS.length);
    const xlm = body.prices.find((p: { asset: string }) => p.asset === 'XLM');
    expect(xlm.priceFloat).toBeCloseTo(1, 5);
    expect(xlm.timestamp).toBe(3);
  });

  it('GET /v1/markets/:asset/price returns the asset price', async () => {
    const setup = await setupTestServer({
      oraclePrices: { ETH: [3_500_0000000n, 99n] },
    });
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/markets/eth/price' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.asset).toBe('ETH');
    expect(body.priceFloat).toBe(3_500);
    expect(body.timestamp).toBe(99);
  });

  it('GET /v1/markets/:asset/price 404s for unknown asset', async () => {
    const setup = await setupTestServer({});
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/markets/PEPE/price' });
    expect(res.statusCode).toBe(404);
  });
});
