import { describe, expect, it, afterEach } from 'vitest';
import { setupTestServer } from './helpers.js';
import { SUPPORTED_ASSETS } from '@noether/shared';

let app: Awaited<ReturnType<typeof setupTestServer>>['app'] | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

/** oraclePrices covering EVERY supported asset with a fresh timestamp. */
function freshPrices(): Record<string, [bigint, bigint]> {
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  return Object.fromEntries(
    SUPPORTED_ASSETS.map((a) => [a.symbol, [1_000_0000000n, nowSec] as [bigint, bigint]]),
  );
}

describe('oracle health routes', () => {
  it('POST /v1/oracle/heartbeat is disabled without a configured secret', async () => {
    const setup = await setupTestServer({});
    app = setup.app;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/oracle/heartbeat',
      payload: { ts: Date.now() },
    });
    expect(res.statusCode).toBe(503);
  });

  it('POST /v1/oracle/heartbeat rejects a wrong secret and accepts the right one', async () => {
    const setup = await setupTestServer({ keeperHeartbeatSecret: 's3cret' });
    app = setup.app;

    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/oracle/heartbeat',
      headers: { 'x-keeper-secret': 'nope' },
      payload: { ts: Date.now() },
    });
    expect(wrong.statusCode).toBe(401);

    const right = await app.inject({
      method: 'POST',
      url: '/v1/oracle/heartbeat',
      headers: { 'x-keeper-secret': 's3cret' },
      payload: { ts: 123, pushed: ['BTC'], stork: { enabled: false } },
    });
    expect(right.statusCode).toBe(204);

    const health = await app.inject({ method: 'GET', url: '/v1/oracle/health' });
    const body = health.json();
    expect(body.keeper.configured).toBe(true);
    expect(body.keeper.stale).toBe(false);
    expect(body.keeper.ageMs).toBeLessThan(10_000);
    expect(body.keeper.lastReport.pushed).toEqual(['BTC']);
  });

  it('GET /v1/oracle/health reports ok when everything is fresh', async () => {
    const setup = await setupTestServer({
      oraclePrices: freshPrices(),
      keeperHeartbeatSecret: 's3cret',
    });
    app = setup.app;
    await app.inject({
      method: 'POST',
      url: '/v1/oracle/heartbeat',
      headers: { 'x-keeper-secret': 's3cret' },
      payload: { ts: Date.now() },
    });

    const res = await app.inject({ method: 'GET', url: '/v1/oracle/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.onchain.staleCount).toBe(0);
    expect(body.onchain.assets).toHaveLength(SUPPORTED_ASSETS.length);
  });

  it('GET /v1/oracle/health reports down when every asset is stale', async () => {
    // Default fake reader returns [0, 0]: epoch timestamps, all stale.
    const setup = await setupTestServer({});
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/oracle/health' });
    const body = res.json();
    expect(body.status).toBe('down');
    expect(body.onchain.staleCount).toBe(SUPPORTED_ASSETS.length);
    // Heartbeat feature off → keeper section must not drag status further.
    expect(body.keeper.configured).toBe(false);
  });

  it('GET /v1/oracle/health reports degraded on partial staleness', async () => {
    const prices = freshPrices();
    prices.BTC = [60_000_0000000n, 1n]; // epoch-old BTC — stale
    const setup = await setupTestServer({ oraclePrices: prices });
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/oracle/health' });
    const body = res.json();
    expect(body.status).toBe('degraded');
    expect(body.onchain.staleCount).toBe(1);
    const btc = body.onchain.assets.find((a: { asset: string }) => a.asset === 'BTC');
    expect(btc.stale).toBe(true);
  });

  it('GET /v1/oracle/health reports degraded when the keeper goes quiet', async () => {
    // Fresh on-chain prices, heartbeat configured but never received.
    const setup = await setupTestServer({
      oraclePrices: freshPrices(),
      keeperHeartbeatSecret: 's3cret',
    });
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/oracle/health' });
    const body = res.json();
    expect(body.status).toBe('degraded');
    expect(body.keeper.stale).toBe(true);
    expect(body.keeper.ageMs).toBe(null);
  });

  it('reports degraded with no keeper secret configured, even on fresh prices', async () => {
    const setup = await setupTestServer({ oraclePrices: freshPrices() });
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/oracle/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // No secret means no keeper signal at all, which is a blind spot, so the
    // status must not read ok.
    expect(body.status).toBe('degraded');
    expect(body.keeper.configured).toBe(false);
  });

  it('strict=1 answers 503 when the status is not ok', async () => {
    const setup = await setupTestServer({ oraclePrices: freshPrices() });
    app = setup.app;
    const plain = await app.inject({ method: 'GET', url: '/v1/oracle/health' });
    expect(plain.statusCode).toBe(200);
    expect(plain.json().status).toBe('degraded');

    const strict = await app.inject({ method: 'GET', url: '/v1/oracle/health?strict=1' });
    expect(strict.statusCode).toBe(503);
    expect(strict.json().status).toBe('degraded');
  });
});
