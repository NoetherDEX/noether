import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Keypair } from '@stellar/stellar-sdk';
import { setupTestServer, signChallengeXdr } from './helpers.js';

/** Workstream A — waitlist join/status, unlock verify, admin surface. */

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function wallet(): string {
  return Keypair.random().publicKey();
}

async function issueKey(server: FastifyInstance, kp: Keypair): Promise<{ keyId: string; secret: string }> {
  const ch = await server.inject({
    method: 'POST',
    url: '/v1/keys/challenge',
    payload: { address: kp.publicKey() },
  });
  const { challengeHex } = ch.json() as { challengeHex: string };
  const res = await server.inject({
    method: 'POST',
    url: '/v1/keys',
    payload: { address: kp.publicKey(), challenge: challengeHex, signature: signChallengeXdr(kp, challengeHex) },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { keyId: string; secret: string };
}

function authHeaders(k: { keyId: string; secret: string }): Record<string, string> {
  return {
    authorization: `Bearer ${k.keyId}:${k.secret}`,
    'x-timestamp': String(Math.floor(Date.now() / 1000)),
  };
}

function joinBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { wallet: wallet(), attest: true, ...overrides };
}

describe('POST /v1/waitlist', () => {
  it('joins, is idempotent, and never loses the first submission', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const w = wallet();
    const first = await app.inject({
      method: 'POST',
      url: '/v1/waitlist',
      payload: joinBody({ wallet: w, email: 'a@example.com', segment: 'trader' }),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ status: 'pending' });

    const again = await app.inject({
      method: 'POST',
      url: '/v1/waitlist',
      payload: joinBody({ wallet: w, email: 'other@example.com' }),
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ status: 'pending' });
    // First write wins — the original email survives the re-submission.
    const grant = await setup.deps.access.grantOf(w);
    expect(grant?.email).toBe('a@example.com');
    expect(grant?.source).toBe('waitlist');
  });

  it('rejects missing attestation, bad wallets, bad emails', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const cases: Array<[Record<string, unknown>, string]> = [
      [joinBody({ attest: false }), 'attestation_required'],
      [joinBody({ wallet: 'G'.padEnd(56, 'A') }), 'invalid_wallet'],
      [joinBody({ email: 'not-an-email' }), 'invalid_email'],
    ];
    for (const [payload, error] of cases) {
      const res = await app.inject({ method: 'POST', url: '/v1/waitlist', payload });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toBe(error);
    }
  });

  it('joins without a captcha token even when Turnstile is not configured', async () => {
    const setup = await setupTestServer({ turnstileDisabled: true });
    app = setup.app;
    const res = await app.inject({ method: 'POST', url: '/v1/waitlist', payload: joinBody() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'pending' });
  });

  it('enforces the tighter per-IP join budget (5/min)', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'POST', url: '/v1/waitlist', payload: joinBody() });
      expect(res.statusCode).toBe(200);
    }
    const sixth = await app.inject({ method: 'POST', url: '/v1/waitlist', payload: joinBody() });
    expect(sixth.statusCode).toBe(429);
  });
});

describe('GET /v1/waitlist/status', () => {
  it('reports coarse status and never discloses negative decisions', async () => {
    const setup = await setupTestServer({ adminWallets: [] });
    app = setup.app;
    const w = wallet();
    const none = await app.inject({ method: 'GET', url: `/v1/waitlist/status?wallet=${w}` });
    expect(none.json()).toEqual({ status: 'none' });

    await app.inject({ method: 'POST', url: '/v1/waitlist', payload: joinBody({ wallet: w }) });
    const pending = await app.inject({ method: 'GET', url: `/v1/waitlist/status?wallet=${w}` });
    expect(pending.json()).toEqual({ status: 'pending' });

    await setup.deps.access.decide({ wallets: [w], action: 'reject', actor: 'GTEST' });
    const rejected = await app.inject({ method: 'GET', url: `/v1/waitlist/status?wallet=${w}` });
    expect(rejected.json()).toEqual({ status: 'pending' });

    await setup.deps.access.decide({ wallets: [w], action: 'approve', actor: 'GTEST' });
    const approved = await app.inject({ method: 'GET', url: `/v1/waitlist/status?wallet=${w}` });
    expect(approved.json()).toEqual({ status: 'approved' });
  });
});

describe('unlock: /v1/access/challenge + /v1/access/verify', () => {
  it('approves a signed challenge from an approved wallet, 403s the rest', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const kp = Keypair.random();

    // Not approved yet → valid signature still 403s.
    let ch = await app.inject({
      method: 'POST',
      url: '/v1/access/challenge',
      payload: { address: kp.publicKey() },
    });
    let { challengeHex } = ch.json() as { challengeHex: string };
    const notApproved = await app.inject({
      method: 'POST',
      url: '/v1/access/verify',
      payload: { address: kp.publicKey(), challenge: challengeHex, signature: signChallengeXdr(kp, challengeHex) },
    });
    expect(notApproved.statusCode).toBe(403);

    await setup.deps.access.decide({
      wallets: [kp.publicKey()],
      action: 'approve',
      wave: 'wave-1',
      actor: 'GTEST',
    });

    // Fresh challenge (they are one-shot) → approved with the wave tag.
    ch = await app.inject({
      method: 'POST',
      url: '/v1/access/challenge',
      payload: { address: kp.publicKey() },
    });
    ({ challengeHex } = ch.json() as { challengeHex: string });
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/access/verify',
      payload: { address: kp.publicKey(), challenge: challengeHex, signature: signChallengeXdr(kp, challengeHex) },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ approved: true, wave: 'wave-1' });

    // A wrong-signer signature never passes.
    ch = await app.inject({
      method: 'POST',
      url: '/v1/access/challenge',
      payload: { address: kp.publicKey() },
    });
    ({ challengeHex } = ch.json() as { challengeHex: string });
    const forged = await app.inject({
      method: 'POST',
      url: '/v1/access/verify',
      payload: {
        address: kp.publicKey(),
        challenge: challengeHex,
        signature: signChallengeXdr(Keypair.random(), challengeHex),
      },
    });
    expect(forged.statusCode).toBe(401);
  });
});

describe('/v1/admin/waitlist surface', () => {
  it('requires auth AND admin membership', async () => {
    const adminKp = Keypair.random();
    const setup = await setupTestServer({ adminWallets: [adminKp.publicKey()] });
    app = setup.app;

    const anon = await app.inject({ method: 'GET', url: '/v1/admin/waitlist' });
    expect(anon.statusCode).toBe(401);

    const outsiderKey = await issueKey(app, Keypair.random());
    const outsider = await app.inject({
      method: 'GET',
      url: '/v1/admin/waitlist',
      headers: authHeaders(outsiderKey),
    });
    expect(outsider.statusCode).toBe(403);
    expect((outsider.json() as { error: string }).error).toBe('not_admin');

    const adminKey = await issueKey(app, adminKp);
    const admin = await app.inject({
      method: 'GET',
      url: '/v1/admin/waitlist',
      headers: authHeaders(adminKey),
    });
    expect(admin.statusCode).toBe(200);
  });

  it('decides in batch, audit-logs, emails once, and exports CSV', async () => {
    const adminKp = Keypair.random();
    const setup = await setupTestServer({ adminWallets: [adminKp.publicKey()] });
    app = setup.app;
    const adminKey = await issueKey(app, adminKp);

    const w1 = wallet();
    const w2 = wallet();
    await app.inject({
      method: 'POST',
      url: '/v1/waitlist',
      payload: joinBody({ wallet: w1, email: 'w1@example.com' }),
    });
    await app.inject({ method: 'POST', url: '/v1/waitlist', payload: joinBody({ wallet: w2 }) });

    const decide = await app.inject({
      method: 'POST',
      url: '/v1/admin/waitlist/decide',
      headers: authHeaders(adminKey),
      payload: { wallets: [w1, w2], action: 'approve', wave: 'wave-1', notes: 'jury batch' },
    });
    expect(decide.statusCode).toBe(200);
    const decided = decide.json() as { updated: string[]; emailed: string[] };
    expect(decided.updated.sort()).toEqual([w1, w2].sort());
    // Only w1 supplied an email.
    expect(decided.emailed).toEqual([w1]);
    expect(setup.sentEmails).toEqual([{ to: 'w1@example.com', wave: 'wave-1' }]);
    expect((await setup.deps.access.grantOf(w1))?.emailSentAt).not.toBeNull();

    // Re-approving does not double-send.
    const again = await app.inject({
      method: 'POST',
      url: '/v1/admin/waitlist/decide',
      headers: authHeaders(adminKey),
      payload: { wallets: [w1], action: 'approve' },
    });
    expect((again.json() as { emailed: string[] }).emailed).toEqual([]);
    expect(setup.sentEmails).toHaveLength(1);

    // Audit trail recorded every decision.
    const audit = await setup.db.execute(
      "SELECT action, wallet FROM access_audit_log WHERE action = 'approve'",
    );
    expect(audit.rows.length).toBe(3);

    // List reflects state; filters work.
    const list = await app.inject({
      method: 'GET',
      url: '/v1/admin/waitlist?status=approved',
      headers: authHeaders(adminKey),
    });
    const listed = list.json() as { rows: Array<{ wallet: string }>; counts: Record<string, number> };
    expect(listed.rows.map((r) => r.wallet).sort()).toEqual([w1, w2].sort());
    expect(listed.counts.approved).toBe(2);

    // Revoke flips status.
    await app.inject({
      method: 'POST',
      url: '/v1/admin/waitlist/decide',
      headers: authHeaders(adminKey),
      payload: { wallets: [w2], action: 'revoke' },
    });
    expect(await setup.deps.access.isApproved(w2)).toBe(false);

    // CSV export carries the rows and audit-logs itself.
    const csv = await app.inject({
      method: 'GET',
      url: '/v1/admin/waitlist/export.csv',
      headers: authHeaders(adminKey),
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain(w1);
    expect(csv.body).toContain('w1@example.com');
    const exportAudit = await setup.db.execute(
      "SELECT COUNT(*) AS n FROM access_audit_log WHERE action = 'export'",
    );
    expect(Number((exportAudit.rows[0] as unknown as { n: unknown }).n)).toBe(1);
  });

  it('admin forget nulls the stored email but keeps status and audit trail', async () => {
    const adminKp = Keypair.random();
    const setup = await setupTestServer({ adminWallets: [adminKp.publicKey()] });
    app = setup.app;
    const adminKey = await issueKey(app, adminKp);
    const w1 = wallet();

    await app.inject({
      method: 'POST',
      url: '/v1/waitlist',
      payload: joinBody({ wallet: w1, email: 'w1@example.com' }),
    });
    await app.inject({
      method: 'POST',
      url: '/v1/admin/waitlist/decide',
      headers: authHeaders(adminKey),
      payload: { wallets: [w1], action: 'approve' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/waitlist/forget',
      headers: authHeaders(adminKey),
      payload: { wallet: w1 },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { forgotten: boolean }).forgotten).toBe(true);

    // Email erased; access status untouched; the erasure itself is audited.
    const grant = await setup.deps.access.grantOf(w1);
    expect(grant?.email ?? null).toBeNull();
    expect(await setup.deps.access.isApproved(w1)).toBe(true);
    const audit = await setup.db.execute(
      "SELECT wallet FROM access_audit_log WHERE action = 'forget_email'",
    );
    expect(audit.rows.length).toBe(1);

    // Unknown wallet reports forgotten:false instead of erroring.
    const missing = await app.inject({
      method: 'POST',
      url: '/v1/admin/waitlist/forget',
      headers: authHeaders(adminKey),
      payload: { wallet: wallet() },
    });
    expect((missing.json() as { forgotten: boolean }).forgotten).toBe(false);
  });

  it('admin approval of a wallet that never joined creates an admin-source grant', async () => {
    const adminKp = Keypair.random();
    const setup = await setupTestServer({ adminWallets: [adminKp.publicKey()] });
    app = setup.app;
    const adminKey = await issueKey(app, adminKp);
    const w = wallet();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/waitlist/decide',
      headers: authHeaders(adminKey),
      payload: { wallets: [w], action: 'approve', wave: 'wave-0' },
    });
    expect((res.json() as { updated: string[] }).updated).toEqual([w]);
    const grant = await setup.deps.access.grantOf(w);
    expect(grant?.source).toBe('admin');
    expect(grant?.status).toBe('approved');
  });
});
