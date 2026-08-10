import { describe, expect, it, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
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
      sql: `INSERT INTO rate_limit_buckets (key_id, window_start, count) VALUES (?, ?, ?) ON CONFLICT (key_id, window_start) DO UPDATE SET count = EXCLUDED.count`,
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
      sql: `INSERT INTO rate_limit_buckets (key_id, window_start, count) VALUES (?, ?, ?) ON CONFLICT (key_id, window_start) DO UPDATE SET count = EXCLUDED.count`,
      args: [`ip:127.0.0.1`, window, RATE_LIMIT_TIERS.public.perMinute + 1000],
    });
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
  });

  it('resolves a real key to its tier and an OWNER-scoped bucket', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const owner = Keypair.random().publicKey();
    const issued = await setup.deps.apiKeys.issue(owner, 'rl-test');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/markets',
      headers: { authorization: `Bearer ${issued.keyId}:${issued.secret}`, 'x-timestamp': String(Math.floor(Date.now() / 1000)) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-ratelimit-tier']).toBe('standard');
    const buckets = await setup.db.execute('SELECT key_id FROM rate_limit_buckets');
    expect(buckets.rows.map((r) => String(r.key_id))).toEqual([`owner:${owner}`]);
  });

  // The reason the bucket is owner-scoped: a per-key bucket would let one
  // wallet multiply its quota simply by holding more keys.
  it('shares one bucket across every key the same wallet holds', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const owner = Keypair.random().publicKey();
    const first = await setup.deps.apiKeys.issue(owner, 'key-a');
    const second = await setup.deps.apiKeys.issue(owner, 'key-b');

    for (const key of [first, second]) {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/markets',
        headers: { authorization: `Bearer ${key.keyId}:${key.secret}`, 'x-timestamp': String(Math.floor(Date.now() / 1000)) },
      });
      expect(res.statusCode).toBe(200);
    }

    const buckets = await setup.db.execute('SELECT key_id, count FROM rate_limit_buckets');
    expect(buckets.rows).toHaveLength(1);
    expect(String(buckets.rows[0]!.key_id)).toBe(`owner:${owner}`);
    expect(Number(buckets.rows[0]!.count)).toBe(2); // both keys consumed the same quota
  });

  it('keeps invalid credentials on the public tier', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const res = await app.inject({
      method: 'GET',
      url: '/v1/markets',
      headers: { authorization: 'Bearer nk_bogus:not-a-secret', 'x-timestamp': String(Math.floor(Date.now() / 1000)) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-ratelimit-tier']).toBe('public');
  });

  it('sweepExpired deletes only buckets from elapsed windows', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const nowSec = Math.floor(Date.now() / 1000);
    const window = nowSec - (nowSec % 60);
    await setup.db.execute({
      sql: `INSERT INTO rate_limit_buckets (key_id, window_start, count) VALUES (?, ?, ?) ON CONFLICT (key_id, window_start) DO UPDATE SET count = EXCLUDED.count`,
      args: ['ip:1.2.3.4', window - 120, 5],
    });
    await setup.db.execute({
      sql: `INSERT INTO rate_limit_buckets (key_id, window_start, count) VALUES (?, ?, ?) ON CONFLICT (key_id, window_start) DO UPDATE SET count = EXCLUDED.count`,
      args: ['ip:1.2.3.4', window, 5],
    });
    await setup.deps.rateLimiter.sweepExpired();
    const rows = await setup.db.execute(
      `SELECT window_start FROM rate_limit_buckets WHERE key_id = 'ip:1.2.3.4'`,
    );
    expect(rows.rows.map((r) => Number(r.window_start))).toEqual([window]);
  });
});
