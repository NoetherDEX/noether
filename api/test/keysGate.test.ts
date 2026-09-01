import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * Closed-beta issuance gate (keys.ts ALLOWLIST). The allowlist is snapshotted
 * from env at MODULE IMPORT, so this file sets the env FIRST and only then
 * dynamically imports the server graph — vitest isolates module graphs per
 * test file, giving this file its own gated keys.ts instance. (This is the
 * route-level coverage the 2026-08 gateway exploration flagged as missing.)
 */

const LISTED = Keypair.random();
process.env.API_KEY_ALLOWLIST = LISTED.publicKey();

const helpers = await import('./helpers.js');

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function tryIssue(server: FastifyInstance, kp: Keypair, label?: string): Promise<number> {
  const ch = await server.inject({
    method: 'POST',
    url: '/v1/keys/challenge',
    payload: { address: kp.publicKey() },
  });
  const { challengeHex } = ch.json() as { challengeHex: string };
  const res = await server.inject({
    method: 'POST',
    url: '/v1/keys',
    payload: {
      address: kp.publicKey(),
      challenge: challengeHex,
      signature: helpers.signChallengeXdr(kp, challengeHex),
      ...(label !== undefined ? { label } : {}),
    },
  });
  return res.statusCode;
}

describe('closed-beta issuance gate (env ∪ access_grants ∪ ADMIN_WALLETS)', () => {
  it('403s an unknown wallet, admits env-listed, DB-approved, and admin wallets', async () => {
    const adminKp = Keypair.random();
    const setup = await helpers.setupTestServer({ adminWallets: [adminKp.publicKey()] });
    app = setup.app;

    // Unknown wallet → gated out.
    expect(await tryIssue(app, Keypair.random())).toBe(403);

    // Env-allowlisted wallet → admitted.
    expect(await tryIssue(app, LISTED)).toBe(201);

    // access_grants-approved wallet → admitted (the waitlist path).
    const approvedKp = Keypair.random();
    await setup.deps.access.decide({
      wallets: [approvedKp.publicKey()],
      action: 'approve',
      actor: 'GTEST',
    });
    expect(await tryIssue(app, approvedKp)).toBe(201);

    // ADMIN_WALLETS wallet → admitted (no chicken-and-egg: the panel that
    // approves wallets must be reachable by its admins).
    expect(await tryIssue(app, adminKp)).toBe(201);

    // beta-status mirrors the same union.
    const probe = async (address: string) =>
      (await app!.inject({ url: `/v1/keys/beta-status?address=${address}` })).json() as {
        gated: boolean;
        allowed: boolean;
      };
    expect(await probe(Keypair.random().publicKey())).toEqual({ gated: true, allowed: false });
    expect(await probe(adminKp.publicKey())).toEqual({ gated: true, allowed: true });
    expect(await probe(approvedKp.publicKey())).toEqual({ gated: true, allowed: true });
  });
});

describe('per-owner issuance cap and session-key labels', () => {
  it('plain keys hit the cap; the sixth issuance 409s', async () => {
    const adminKp = Keypair.random();
    const setup = await helpers.setupTestServer({ adminWallets: [adminKp.publicKey()] });
    app = setup.app;
    for (let i = 0; i < 5; i++) {
      expect(await tryIssue(app, adminKp)).toBe(201);
    }
    expect(await tryIssue(app, adminKp)).toBe(409);
  });

  it('admin-panel keys never march into the cap: prior ones retire on issue', async () => {
    const adminKp = Keypair.random();
    const setup = await helpers.setupTestServer({ adminWallets: [adminKp.publicKey()] });
    app = setup.app;
    // Seven consecutive sign-ins, two past the cap, all succeed.
    for (let i = 0; i < 7; i++) {
      expect(await tryIssue(app, adminKp, 'admin-panel')).toBe(201);
    }
    // Only the newest session key stays active.
    expect(await setup.deps.apiKeys.countActiveForOwner(adminKp.publicKey())).toBe(1);
  });

  it('a wallet stuck at the cap with stale admin-panel keys can still sign in', async () => {
    const adminKp = Keypair.random();
    const setup = await helpers.setupTestServer({ adminWallets: [adminKp.publicKey()] });
    app = setup.app;
    // Reproduce the incident: five stale admin-panel session keys.
    for (let i = 0; i < 5; i++) {
      await setup.deps.apiKeys.issue(adminKp.publicKey(), 'admin-panel');
    }
    expect(await tryIssue(app, adminKp, 'admin-panel')).toBe(201);
    expect(await setup.deps.apiKeys.countActiveForOwner(adminKp.publicKey())).toBe(1);
  });
});
