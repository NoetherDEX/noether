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
    expect(classifySubmitFailure({ status: 'SUCCESS' })).toBe('none');
    // The stale-resource result codes carry no diagnostic event (web parity).
    expect(classifySubmitFailure({ status: 'FAILED', txResultCode: 'txSorobanInvalid' })).toBe('stale_footprint');
    expect(classifySubmitFailure({ status: 'FAILED', txResultCode: 'txInsufficientRefundableFee' })).toBe('stale_footprint');
    expect(classifySubmitFailure({ status: 'FAILED', txResultCode: 'txFailed' })).toBe('none');
    // PENDING may still apply — never rebuild on top of it.
    expect(classifySubmitFailure({ status: 'PENDING', hostError: { type: 'storage', code: 'exceeded_limit' } })).toBe('none');
    // Send-stage rejection (400) carries the same facts in the body.
    expect(classifySubmitFailure({ httpStatus: 400, errorCode: 'submission_rejected', hostError: { type: 'storage', code: 'exceeded_limit' } })).toBe('stale_footprint');
    expect(classifySubmitFailure({ httpStatus: 400, errorCode: 'submission_rejected', txResultCode: 'txSorobanInvalid' })).toBe('stale_footprint');
    expect(classifySubmitFailure({ httpStatus: 400, errorCode: 'FST_ERR_VALIDATION', txResultCode: 'txSorobanInvalid' })).toBe('none');
    // Only the gateway's own RPC-queue signal is a safe retry; a generic 503
    // may arrive after attempt 1 was broadcast.
    expect(classifySubmitFailure({ httpStatus: 503, errorCode: 'try_again_later' })).toBe('try_again_later');
    expect(classifySubmitFailure({ httpStatus: 503 })).toBe('none');
    expect(classifySubmitFailure({ httpStatus: 503, errorCode: 'upstream_unavailable' })).toBe('none');
    expect(classifySubmitFailure({ httpStatus: 502, errorCode: 'rpc_error' })).toBe('none');
  });

  it('rebuilds once when the RPC rejected the send with a host trap (400 submission_rejected)', async () => {
    const { client, fake } = makeClient({
      credentials: { apiKey: 'k', secret: 's' },
      scripts: [
        { status: 200, body: PREPARED },
        { status: 400, body: { error: 'submission_rejected', message: 'Submission rejected by RPC', contractError: null, hostError: { type: 'storage', code: 'exceeded_limit' } } },
        { status: 200, body: { ...PREPARED, xdr: 'BBBB' } },
        { status: 200, body: { hash: 'h2', status: 'SUCCESS', contractError: null, hostError: null } },
      ],
    });
    const res = await client.executeTrade({ request: REQUEST, signer: (x) => x });
    expect(res.submitted.status).toBe('SUCCESS');
    expect(fake.calls).toHaveLength(4);
  });

  it('retries the RPC-queue 503 after the configured pause, but never a generic 503', async () => {
    const queue = makeClient({
      credentials: { apiKey: 'k', secret: 's' },
      scripts: [
        { status: 200, body: PREPARED },
        { status: 503, headers: { 'retry-after': '2' }, body: { error: 'try_again_later', retryable: true, hash: 'h1' } },
        { status: 200, body: PREPARED },
        { status: 200, body: { hash: 'h2', status: 'SUCCESS', contractError: null, hostError: null } },
      ],
    });
    const ok = await queue.client.executeTrade({ request: REQUEST, signer: (x) => x, retryDelayMs: 0 });
    expect(ok.submitted.hash).toBe('h2');
    expect(queue.fake.calls).toHaveLength(4);

    // An ingress 503 after the gateway may already have broadcast attempt 1:
    // a rebuilt copy could double-open, so it surfaces as the error it is.
    const outage = makeClient({
      credentials: { apiKey: 'k', secret: 's' },
      scripts: [{ status: 200, body: PREPARED }, { status: 503, body: { error: 'upstream_unavailable' } }],
    });
    await expect(outage.client.executeTrade({ request: REQUEST, signer: (x) => x, retryDelayMs: 0 })).rejects.toMatchObject({ status: 503 });
    expect(outage.fake.calls).toHaveLength(2);
  });
});
