import { describe, expect, it } from 'vitest';
import { makeClient } from './helpers.js';

const REFERRER = {
  referrer: 'GREF',
  code: 'alice',
  createdAt: 1,
  referredCount: 2,
  totalVolumeGenerated: '1000',
  totalEarned: '10',
  claimable: '5',
  updatedAt: 2,
};

describe('referral sub-client', () => {
  it('info(address) returns { self, binding } from the public endpoint', async () => {
    const { client, fake } = makeClient({
      scripts: [{ status: 200, body: { self: REFERRER, binding: null } }],
    });
    const res = await client.referral.info('GREF');
    const url = new URL(fake.calls[0]!.url);
    expect(url.pathname).toBe('/v1/referral/info');
    expect(url.searchParams.get('address')).toBe('GREF');
    expect(res?.self?.code).toBe('alice');
    expect(res?.binding).toBeNull();
  });

  it('info(address) returns null on 404', async () => {
    const { client } = makeClient({
      scripts: [{ status: 404, body: { error: 'no_code' } }],
    });
    expect(await client.referral.info('GNONE')).toBeNull();
  });
});
