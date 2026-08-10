import { describe, expect, it } from 'vitest';
import { makeClient } from './helpers.js';
import {
  AuthError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  RegionRestrictedError,
  ServerError,
  ServiceUnavailableError,
} from '../src/index.js';

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

  it('401 → AuthError but not ForbiddenError', async () => {
    const { client } = makeClient({
      scripts: [{ status: 401, body: { error: 'invalid_credentials' } }],
    });
    const err = await client.markets.list().catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err).not.toBeInstanceOf(ForbiddenError);
    expect(err.code).toBe('invalid_credentials');
  });

  it('403 not_in_beta → ForbiddenError, distinguishable from 401', async () => {
    const { client } = makeClient({
      scripts: [{ status: 403, body: { error: 'not_in_beta' } }],
    });
    const err = await client.markets.list().catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    // Still an AuthError so pre existing catch blocks keep working.
    expect(err).toBeInstanceOf(AuthError);
    expect(err.status).toBe(403);
    expect(err.code).toBe('not_in_beta');
  });

  it('409 key_limit_reached → ConflictError', async () => {
    const { client } = makeClient({
      scripts: [{ status: 409, body: { error: 'key_limit_reached' } }],
    });
    const err = await client.markets.list().catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).not.toBeInstanceOf(BadRequestError);
    expect(err.code).toBe('key_limit_reached');
  });

  it('451 region_restricted → RegionRestrictedError', async () => {
    const { client } = makeClient({
      scripts: [{ status: 451, body: { error: 'region_restricted' } }],
    });
    const err = await client.markets.list().catch((e) => e);
    expect(err).toBeInstanceOf(RegionRestrictedError);
    expect(err).not.toBeInstanceOf(BadRequestError);
    expect(err.code).toBe('region_restricted');
  });

  it('503 try_again_later → ServiceUnavailableError with retryAfterSec', async () => {
    const { client } = makeClient({
      scripts: [
        {
          status: 503,
          headers: { 'retry-after': '2' },
          body: { error: 'try_again_later', retryable: true },
        },
      ],
    });
    const err = await client.markets.list().catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableError);
    // Still a ServerError so pre existing catch blocks keep working.
    expect(err).toBeInstanceOf(ServerError);
    expect(err.retryAfterSec).toBe(2);
    expect(err.code).toBe('try_again_later');
  });

  it('code getter is null when the body carries no error string', async () => {
    const { client } = makeClient({
      scripts: [{ status: 400, body: { message: 'nope' } }],
    });
    const err = await client.markets.list().catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err.code).toBeNull();
  });
});
