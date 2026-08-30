import { describe, expect, it } from 'vitest';
import { makeClient } from './helpers.js';
import { classifySubmitFailure } from '../src/retry.js';

const PREPARED = { xdr: 'AAAA', minResourceFee: '100' };
const REQUEST = { action: 'close_position', trader: 'GABC', positionId: 1 } as never;

describe('executeTrade retry on a stale footprint', () => {
  it('re-prepares, re-signs and resubmits once when the first apply trapped on the footprint', async () => {
    const { client, fake } = makeClient({
      credentials: { apiKey: 'k', secret: 's' },
      scripts: [
        { status: 200, body: PREPARED },
        { status: 200, body: { hash: 'h1', status: 'FAILED', contractError: null, hostError: { type: 'storage', code: 'exceeded_limit' } } },
        { status: 200, body: { ...PREPARED, xdr: 'BBBB' } },
        { status: 200, body: { hash: 'h2', status: 'SUCCESS', contractError: null, hostError: null } },
      ],
    });
    const signed: string[] = [];
    const res = await client.executeTrade({ request: REQUEST, signer: (xdr) => { signed.push(xdr); return `signed:${xdr}`; } });
    expect(res.submitted.status).toBe('SUCCESS');
    expect(res.submitted.hash).toBe('h2');
    expect(signed).toEqual(['AAAA', 'BBBB']); // fresh bytes on the retry
    expect(fake.calls.map((c) => c.url.split('/v1/')[1])).toEqual(['orders/prepare', 'tx/submit', 'orders/prepare', 'tx/submit']);
  });

  it('does not retry a contract revert, and honours the opt-out', async () => {
    const revert = { hash: 'h1', status: 'FAILED', contractError: { code: 30, name: 'PriceStale' }, hostError: null };
    const a = makeClient({ credentials: { apiKey: 'k', secret: 's' }, scripts: [{ status: 200, body: PREPARED }, { status: 200, body: revert }] });
    const r1 = await a.client.executeTrade({ request: REQUEST, signer: (x) => x });
    expect(r1.submitted.status).toBe('FAILED');
    expect(a.fake.calls).toHaveLength(2);

    const stale = { hash: 'h1', status: 'FAILED', contractError: null, hostError: { type: 'storage', code: 'exceeded_limit' } };
    const b = makeClient({ credentials: { apiKey: 'k', secret: 's' }, scripts: [{ status: 200, body: PREPARED }, { status: 200, body: stale }] });
    const r2 = await b.client.executeTrade({ request: REQUEST, signer: (x) => x, retryOnStaleFootprint: false });
    expect(r2.submitted.status).toBe('FAILED');
    expect(b.fake.calls).toHaveLength(2);
  });

  it('classifies gateway shapes', () => {
    expect(classifySubmitFailure({ status: 'FAILED', hostError: { type: 'budget', code: 'exceeded_limit' } })).toBe('stale_footprint');
    expect(classifySubmitFailure({ status: 'FAILED', contractError: { code: 63 }, hostError: { type: 'storage', code: 'exceeded_limit' } })).toBe('none');
    expect(classifySubmitFailure({ httpStatus: 503 })).toBe('try_again_later');
    expect(classifySubmitFailure({ status: 'SUCCESS' })).toBe('none');
  });
});
