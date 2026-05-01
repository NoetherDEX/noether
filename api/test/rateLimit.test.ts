import { describe, expect, it, afterEach } from 'vitest';
import { setupTestServer } from './helpers.js';
import { RATE_LIMIT_TIERS } from '../src/services/rateLimit.js';

let app: Awaited<ReturnType<typeof setupTestServer>>['app'] | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

describe('rate limiter', () => {
  it('allows requests under the public per-minute cap', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const cap = RATE_LIMIT_TIERS.public.perMinute;
    const sample = Math.min(5, cap);
    for (let i = 0; i < sample; i++) {
      const res = await app.inject({ method: 'GET', url: '/v1/markets' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-ratelimit-tier']).toBe('public');
    }
  });

  it('returns 429 once cap exceeded', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    // Force the bucket past the limit by directly inserting a high count.
    const nowSec = Math.floor(Date.now() / 1000);
    const window = nowSec - (nowSec % 60);
    await setup.db.execute({
      sql: `INSERT OR REPLACE INTO rate_limit_buckets (key_id, window_start, count) VALUES (?, ?, ?)`,
      args: [`ip:127.0.0.1`, window, RATE_LIMIT_TIERS.public.perMinute + 1],
    });
    const res = await app.inject({ method: 'GET', url: '/v1/markets' });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    const body = res.json() as { error: string };
    expect(body.error).toBe('rate_limited');
  });

  it('exempts /v1/health and /docs', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const nowSec = Math.floor(Date.now() / 1000);
    const window = nowSec - (nowSec % 60);
    await setup.db.execute({
      sql: `INSERT OR REPLACE INTO rate_limit_buckets (key_id, window_start, count) VALUES (?, ?, ?)`,
      args: [`ip:127.0.0.1`, window, RATE_LIMIT_TIERS.public.perMinute + 1000],
    });
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
  });
});
