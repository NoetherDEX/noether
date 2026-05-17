import { describe, expect, it } from 'vitest';
import { makeClient } from './helpers.js';

describe('orders + tx sub-clients', () => {
  it('orders.prepare serialises bigints to strings', async () => {
    const { client, fake } = makeClient({
      credentials: { keyId: 'nk', secret: 's' },
      scripts: [{ status: 200, body: { op: 'open_position', trader: 'G', xdr: 'xdr-1', minResourceFee: '1000' } }],
    });
    const prep = await client.orders.prepare({
      op: 'open_position',
      asset: 'BTC',
      collateral: 1_000_000_000n,
      leverage: 5,
      direction: 'Long',
    });
    expect(prep.xdr).toBe('xdr-1');
    const body = JSON.parse(String(fake.calls[0]!.init!.body));
    expect(body.collateral).toBe('1000000000');
    expect(body.leverage).toBe(5);
    expect(body.direction).toBe('Long');
  });

  it('tx.submit forwards body and returns shape', async () => {
    const { client, fake } = makeClient({
      credentials: { keyId: 'nk', secret: 's' },
      scripts: [{ status: 200, body: { hash: 'abc', status: 'SUCCESS' } }],
    });
    const result = await client.tx.submit({ signedXdr: 'AAAA==', pollTimeoutMs: 5000 });
    expect(result.hash).toBe('abc');
    expect(result.status).toBe('SUCCESS');
    const body = JSON.parse(String(fake.calls[0]!.init!.body));
    expect(body.signedXdr).toBe('AAAA==');
    expect(body.pollTimeoutMs).toBe(5000);
  });

  it('executeTrade chains prepare → sign → submit', async () => {
    const seenSign: string[] = [];
    const { client, fake } = makeClient({
      credentials: { keyId: 'nk', secret: 's' },
      scripts: [
        { status: 200, body: { op: 'cancel_order', trader: 'G', xdr: 'xdr-cancel' } },
        { status: 200, body: { hash: 'tx-hash', status: 'SUCCESS' } },
      ],
    });
    const result = await client.executeTrade({
      request: { op: 'cancel_order', orderId: 7 },
      signer: (xdr) => {
        seenSign.push(xdr);
        return `signed:${xdr}`;
      },
    });
    expect(result.prepared.xdr).toBe('xdr-cancel');
    expect(result.submitted.hash).toBe('tx-hash');
    expect(seenSign).toEqual(['xdr-cancel']);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.url).toBe('http://api.test/v1/tx/submit');
    const submitBody = JSON.parse(String(fake.calls[1]!.init!.body));
    expect(submitBody.signedXdr).toBe('signed:xdr-cancel');
  });
});
