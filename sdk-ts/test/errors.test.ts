import { describe, expect, it } from 'vitest';
import { makeClient } from './helpers.js';
import { BadRequestError, NotFoundError, RateLimitError, ServerError } from '../src/index.js';

describe('error classification', () => {
  it('400 → BadRequestError', async () => {
    const { client } = makeClient({
      scripts: [{ status: 400, body: { error: 'unsupported_asset', asset: 'DOGE' } }],
    });
    const err = await client.markets.get('DOGE').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err.body.error).toBe('unsupported_asset');
  });

  it('404 → NotFoundError', async () => {
    const { client } = makeClient({
      scripts: [{ status: 404, body: { error: 'Unknown asset' } }],
    });
    await expect(client.markets.get('DOGE')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('429 → RateLimitError with retryAfterSec', async () => {
    const { client } = makeClient({
      scripts: [{ status: 429, headers: { 'retry-after': '12' }, body: { error: 'rate_limited', retry_after_sec: 12 } }],
    });
    const err = await client.markets.list().catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterSec).toBe(12);
  });

  it('500 → ServerError', async () => {
    const { client } = makeClient({
      scripts: [{ status: 500, body: { error: 'boom' } }],
    });
    await expect(client.markets.list()).rejects.toBeInstanceOf(ServerError);
  });
});
