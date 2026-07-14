import { describe, expect, it, vi } from 'vitest';
import { RpcPool, fetchEvents, parseRetentionError } from '../src/rpc.js';

describe('parseRetentionError', () => {
  it('parses the retained range out of startLedger errors', () => {
    expect(parseRetentionError(new Error('startLedger must be within the ledger range: 500 - 900')))
      .toEqual({ oldestLedger: 500, latestLedger: 900 });
  });

  it('parses cursor out-of-range errors', () => {
    expect(parseRetentionError(new Error('cursor must be within the ledger range: 12 - 90')))
      .toEqual({ oldestLedger: 12, latestLedger: 90 });
  });

  it('flags retention errors even when the range is missing', () => {
    expect(parseRetentionError(new Error('startLedger is before the oldest ledger')))
      .toEqual({ oldestLedger: null, latestLedger: null });
  });

  it('ignores transient errors', () => {
    expect(parseRetentionError(new Error('ECONNRESET'))).toBeNull();
    expect(parseRetentionError(new Error('TRY_AGAIN_LATER'))).toBeNull();
  });

  it('classifies PLAIN-OBJECT throws from the stellar-sdk (the 2026-06/07 prod freeze)', () => {
    // The sdk raises JSON-RPC failures as bare objects, not Error instances —
    // String(err) is "[object Object]", which silently defeated the clamp and
    // pinned the production cursor at 2,971,053 for five weeks.
    expect(
      parseRetentionError({ code: -32600, message: 'startLedger must be within the ledger range: 3483517 - 3604476' }),
    ).toEqual({ oldestLedger: 3483517, latestLedger: 3604476 });
    expect(parseRetentionError({ code: -32600, message: 'something else' })).toBeNull();
    expect(parseRetentionError(null)).toBeNull();
  });
});

describe('fetchEvents failover', () => {
  it('rotates to the next RPC on a transient failure', async () => {
    const bad = { getEvents: vi.fn(async () => { throw new Error('ECONNRESET'); }) };
    const good = { getEvents: vi.fn(async () => ({ events: [], cursor: 'c', latestLedger: 1 })) };
    const pool = new RpcPool([bad as never, good as never], ['bad://rpc', 'good://rpc']);

    const res = await fetchEvents(pool, { startLedger: 1, contractIds: ['C'] }, 3);

    expect(res.cursor).toBe('c');
    expect(bad.getEvents).toHaveBeenCalledTimes(1);
    expect(good.getEvents).toHaveBeenCalledTimes(1);
    expect(pool.currentUrl()).toBe('good://rpc');
  });

  it('throws retention errors immediately without retrying', async () => {
    const rpc = {
      getEvents: vi.fn(async () => {
        throw new Error('startLedger must be within the ledger range: 500 - 900');
      }),
    };
    const pool = new RpcPool([rpc as never], ['only://rpc']);

    await expect(fetchEvents(pool, { startLedger: 1, contractIds: ['C'] })).rejects.toThrow('ledger range');
    expect(rpc.getEvents).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-transient errors without rotating', async () => {
    const bad = { getEvents: vi.fn(async () => { throw new Error('boom'); }) };
    const good = { getEvents: vi.fn(async () => ({ events: [], cursor: 'c', latestLedger: 1 })) };
    const pool = new RpcPool([bad as never, good as never], ['bad://rpc', 'good://rpc']);

    await expect(fetchEvents(pool, { startLedger: 1, contractIds: ['C'] })).rejects.toThrow('boom');
    expect(good.getEvents).not.toHaveBeenCalled();
    expect(pool.currentUrl()).toBe('bad://rpc');
  });
});
