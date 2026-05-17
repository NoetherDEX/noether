import { describe, expect, it, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { setupTestServer, signChallengeXdr } from './helpers.js';

let app: Awaited<ReturnType<typeof setupTestServer>>['app'] | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

async function createKey(): Promise<{
  app: Awaited<ReturnType<typeof setupTestServer>>['app'];
  db: Awaited<ReturnType<typeof setupTestServer>>['db'];
  keyId: string;
  secret: string;
  address: string;
  kp: Keypair;
}> {
  const setup = await setupTestServer();
  app = setup.app;
  const kp = Keypair.random();
  const address = kp.publicKey();

  const challengeRes = await app.inject({
    method: 'POST',
    url: '/v1/keys/challenge',
    payload: { address },
  });
  expect(challengeRes.statusCode).toBe(200);
  const challenge = challengeRes.json() as { challengeHex: string };

  const signature = signChallengeXdr(kp, challenge.challengeHex);
  const issuedRes = await app.inject({
    method: 'POST',
    url: '/v1/keys',
    payload: { address, challenge: challenge.challengeHex, signature, label: 'test' },
  });
  expect(issuedRes.statusCode).toBe(201);
  const { keyId, secret } = issuedRes.json() as { keyId: string; secret: string };
  return { app: setup.app, db: setup.db, keyId, secret, address, kp };
}

describe('challenge + key issuance', () => {
  it('issues a challenge and verifies the wallet signature', async () => {
    const { app, address } = await createKey();
    expect(app).toBeDefined();
    expect(address).toMatch(/^G/);
  });

  it('rejects an invalid signature', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const kp = Keypair.random();
    const address = kp.publicKey();
    const challengeRes = await app.inject({
      method: 'POST',
      url: '/v1/keys/challenge',
      payload: { address },
    });
    const challenge = challengeRes.json() as { challengeHex: string };
    // Sign with a different key
    const wrongKp = Keypair.random();
    const signature = signChallengeXdr(wrongKp, challenge.challengeHex);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/keys',
      payload: { address, challenge: challenge.challengeHex, signature },
    });
    expect(res.statusCode).toBe(401);
  });

  it('challenge is single-use', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const kp = Keypair.random();
    const address = kp.publicKey();
    const cRes = await app.inject({ method: 'POST', url: '/v1/keys/challenge', payload: { address } });
    const challenge = cRes.json() as { challengeHex: string };
    const sig = signChallengeXdr(kp, challenge.challengeHex);
    const a = await app.inject({
      method: 'POST',
      url: '/v1/keys',
      payload: { address, challenge: challenge.challengeHex, signature: sig },
    });
    expect(a.statusCode).toBe(201);
    const b = await app.inject({
      method: 'POST',
      url: '/v1/keys',
      payload: { address, challenge: challenge.challengeHex, signature: sig },
    });
    expect(b.statusCode).toBe(401);
  });
});

describe('bearer auth on protected routes', () => {
  it('rejects missing bearer', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/account/me' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects malformed bearer', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const res = await app.inject({
      method: 'GET',
      url: '/v1/account/me',
      headers: { authorization: 'Bearer no-colon-here' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts valid Bearer keyId:secret', async () => {
    const { app: a, keyId, secret, address } = await createKey();
    app = a;
    const res = await app.inject({
      method: 'GET',
      url: '/v1/account/me',
      headers: { authorization: `Bearer ${keyId}:${secret}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { owner: string; tier: string };
    expect(body.owner).toBe(address);
    expect(body.tier).toBe('standard');
  });

  it('rejects revoked key', async () => {
    const { app: a, keyId, secret } = await createKey();
    app = a;
    const auth = `Bearer ${keyId}:${secret}`;
    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/keys/${keyId}`,
      headers: { authorization: auth },
    });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({
      method: 'GET',
      url: '/v1/account/me',
      headers: { authorization: auth },
    });
    expect(after.statusCode).toBe(401);
  });

  it('lists owner keys', async () => {
    const { app: a, keyId, secret } = await createKey();
    app = a;
    const res = await app.inject({
      method: 'GET',
      url: '/v1/keys',
      headers: { authorization: `Bearer ${keyId}:${secret}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { keys: Array<{ keyId: string; tier: string }> };
    expect(body.keys.length).toBeGreaterThanOrEqual(1);
    expect(body.keys[0]!.keyId).toBe(keyId);
  });
});

describe('account/me/events filtering', () => {
  it('filters events_raw by trader', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const kp = Keypair.random();
    const address = kp.publicKey();

    // seed events: two for our trader, one for someone else
    const otherAddress = Keypair.random().publicKey();
    await setup.db.execute({
      sql: `INSERT INTO events_raw (event_id, contract_id, topic, ledger, ledger_close_ts, tx_hash, payload_json, inserted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['e1', 'C', 'position_opened', 100, 1, 't', JSON.stringify({ trader: address, positionId: 1 }), Date.now()],
    });
    await setup.db.execute({
      sql: `INSERT INTO events_raw (event_id, contract_id, topic, ledger, ledger_close_ts, tx_hash, payload_json, inserted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['e2', 'C', 'position_closed', 102, 1, 't', JSON.stringify({ trader: address, positionId: 1 }), Date.now()],
    });
    await setup.db.execute({
      sql: `INSERT INTO events_raw (event_id, contract_id, topic, ledger, ledger_close_ts, tx_hash, payload_json, inserted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ['e3', 'C', 'position_opened', 103, 1, 't', JSON.stringify({ trader: otherAddress, positionId: 9 }), Date.now()],
    });

    // create key for our address
    const cRes = await app.inject({ method: 'POST', url: '/v1/keys/challenge', payload: { address } });
    const challenge = cRes.json() as { challengeHex: string };
    const sig = signChallengeXdr(kp, challenge.challengeHex);
    const issued = await app.inject({
      method: 'POST',
      url: '/v1/keys',
      payload: { address, challenge: challenge.challengeHex, signature: sig },
    });
    const { keyId, secret } = issued.json() as { keyId: string; secret: string };

    const res = await app.inject({
      method: 'GET',
      url: '/v1/account/me/events',
      headers: { authorization: `Bearer ${keyId}:${secret}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: Array<{ eventId: string }> };
    const ids = body.events.map((e) => e.eventId).sort();
    expect(ids).toEqual(['e1', 'e2']);
  });
});
