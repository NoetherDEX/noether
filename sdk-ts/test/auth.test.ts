import { describe, expect, it } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { makeClient } from './helpers.js';
import { AuthError } from '../src/index.js';

describe('keys sub-client (challenge flow)', () => {
  it('create() round-trips challenge → sign → exchange', async () => {
    const kp = Keypair.random();
    const address = kp.publicKey();

    const { client, fake } = makeClient({
      scripts: [
        { status: 200, body: { challengeHex: 'aabbccdd', expiresAt: 999 } },
        {
          status: 201,
          body: {
            keyId: 'nk_abc',
            secret: 'sec',
            owner: address,
            tier: 'standard',
            createdAt: 1,
          },
        },
      ],
    });

    const issued = await client.keys.create({
      address,
      signer: (data) => kp.sign(data),
    });
    expect(issued.keyId).toBe('nk_abc');
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]!.url).toBe('http://api.test/v1/keys/challenge');
    expect(fake.calls[1]!.url).toBe('http://api.test/v1/keys');
    const exchangeBody = JSON.parse(String(fake.calls[1]!.init!.body));
    expect(exchangeBody.address).toBe(address);
    expect(exchangeBody.challenge).toBe('aabbccdd');
    expect(typeof exchangeBody.signature).toBe('string');
    expect(exchangeBody.signature.length).toBeGreaterThan(0);
  });

  it('throws AuthError on 401 from exchange', async () => {
    const kp = Keypair.random();
    const { client } = makeClient({
      scripts: [
        { status: 200, body: { challengeHex: 'aabb', expiresAt: 1 } },
        { status: 401, body: { error: 'invalid_signature' } },
      ],
    });
    await expect(
      client.keys.create({ address: kp.publicKey(), signer: (d) => kp.sign(d) }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('account.me() requires credentials', async () => {
    const { client } = makeClient();
    await expect(client.account.me()).rejects.toThrow(/authenticated/);
  });

  it('betaStatus() hits /v1/keys/beta-status with the address', async () => {
    const { client, fake } = makeClient({
      scripts: [{ status: 200, body: { gated: true, allowed: false } }],
    });
    const status = await client.keys.betaStatus('G'.padEnd(56, 'A'));
    const url = new URL(fake.calls[0]!.url);
    expect(url.pathname).toBe('/v1/keys/beta-status');
    expect(url.searchParams.get('address')).toBe('G'.padEnd(56, 'A'));
    expect(status).toEqual({ gated: true, allowed: false });
  });
});

describe('authed bearer header', () => {
  it('attaches Bearer + X-Timestamp on authed requests', async () => {
    const { client, fake } = makeClient({
      credentials: { keyId: 'nk_x', secret: 'shh' },
      scripts: [{ status: 200, body: { owner: 'G', tier: 'standard', keyId: 'nk_x' } }],
    });
    await client.account.me();
    const headers = fake.calls[0]!.init!.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer nk_x:shh');
    expect(headers['x-timestamp']).toMatch(/^\d+$/);
  });
});
