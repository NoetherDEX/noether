import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { StrKey } from '@stellar/stellar-sdk';
import type { AccessGrantsService, GrantAction, GrantSegment, GrantStatus } from '../services/accessGrants.js';
import type { ApprovalEmailer } from '../services/accessEmail.js';
import type { TurnstileVerifier } from '../services/turnstile.js';
import type { WalletAuth } from '../services/walletAuth.js';

/**
 * Workstream A routes — the access system.
 *
 * Public (per-IP rate-limited; join additionally Turnstile-gated and under
 * the tighter join budget in the rateLimit plugin):
 *   POST /v1/waitlist            join (idempotent)
 *   GET  /v1/waitlist/status     coarse approved|pending|none
 *   POST /v1/access/challenge    one-shot unlock challenge
 *   POST /v1/access/verify       signed challenge + approval check — called
 *                                server-side by the web's cookie-setting
 *                                route, so the one-shot challenge is only
 *                                ever consumed there.
 *
 * Admin (bearer key + wallet ∈ ADMIN_WALLETS):
 *   GET  /v1/admin/waitlist
 *   POST /v1/admin/waitlist/decide
 *   GET  /v1/admin/waitlist/export.csv
 */

export interface AccessRouteDeps {
  access: AccessGrantsService;
  /** Dedicated WalletAuth instance — the pending-challenge map is keyed by
   *  address only, so sharing the key-issuance instance would let the two
   *  flows overwrite each other's challenges. */
  walletAuth: WalletAuth;
  turnstile: TurnstileVerifier;
  emailer: ApprovalEmailer;
  adminWallets: string[];
}

const ERROR_SCHEMA = {
  type: 'object',
  properties: { error: { type: 'string' }, message: { type: 'string' } },
  additionalProperties: true,
} as const;

const GRANT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    wallet: { type: 'string' },
    email: { type: ['string', 'null'] },
    status: { type: 'string' },
    source: { type: 'string' },
    wave: { type: ['string', 'null'] },
    segment: { type: ['string', 'null'] },
    requestedAt: { type: 'string' },
    decidedAt: { type: ['string', 'null'] },
    decidedBy: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    emailSentAt: { type: ['string', 'null'] },
  },
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SEGMENTS = new Set<GrantSegment>(['trader', 'lp', 'both']);
const STATUSES = new Set<GrantStatus>(['pending', 'approved', 'rejected', 'revoked']);
const ACTIONS = new Set<GrantAction>(['approve', 'reject', 'revoke']);

interface JoinBody {
  wallet: string;
  email?: string;
  segment?: string;
  attest: boolean;
  turnstileToken: string;
}

interface VerifyBody {
  address: string;
  challenge: string;
  signature: string;
}

interface DecideBody {
  wallets: string[];
  action: string;
  wave?: string;
  notes?: string;
}

export async function registerAccessRoutes(app: FastifyInstance, deps: AccessRouteDeps): Promise<void> {
  const adminSet = new Set(deps.adminWallets);

  // Composes with app.requireAuth: 403 unless the bearer key's owner wallet
  // is in ADMIN_WALLETS. An empty admin set fails closed for everyone.
  async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!req.user || !adminSet.has(req.user.owner)) {
      return reply.code(403).send({ error: 'not_admin' });
    }
  }

  app.post<{ Body: JoinBody }>(
    '/v1/waitlist',
    {
      schema: {
        description:
          'Public — join the mainnet v1 waitlist. Idempotent: re-submitting returns the current status. ' +
          'Requires the eligibility attestation and a Cloudflare Turnstile token.',
        tags: ['access'],
        body: {
          type: 'object',
          properties: {
            wallet: { type: 'string', minLength: 56, maxLength: 56 },
            email: { type: 'string', maxLength: 254 },
            segment: { type: 'string', enum: ['trader', 'lp', 'both'] },
            attest: { type: 'boolean' },
            turnstileToken: { type: 'string', maxLength: 4096 },
          },
          required: ['wallet', 'attest', 'turnstileToken'],
        },
        response: {
          200: {
            type: 'object',
            properties: { status: { type: 'string' } },
            required: ['status'],
          },
          400: ERROR_SCHEMA,
          503: ERROR_SCHEMA,
        },
      },
    },
    async (req, reply) => {
      if (!deps.turnstile.enabled) {
        return reply.code(503).send({ error: 'waitlist_not_configured' });
      }
      const { wallet, email, segment, attest, turnstileToken } = req.body;
      if (attest !== true) {
        return reply.code(400).send({
          error: 'attestation_required',
          message: 'You must accept the terms and confirm eligibility to join.',
        });
      }
      if (!StrKey.isValidEd25519PublicKey(wallet)) {
        return reply.code(400).send({ error: 'invalid_wallet' });
      }
      if (email !== undefined && email !== '' && !EMAIL_RE.test(email)) {
        return reply.code(400).send({ error: 'invalid_email' });
      }
      if (segment !== undefined && !SEGMENTS.has(segment as GrantSegment)) {
        return reply.code(400).send({ error: 'invalid_segment' });
      }
      if (!(await deps.turnstile.verify(turnstileToken, req.ip))) {
        return reply.code(400).send({ error: 'turnstile_failed' });
      }
      const { status } = await deps.access.join({
        wallet,
        email: email || undefined,
        segment: segment as GrantSegment | undefined,
      });
      return reply.send({ status });
    },
  );

  app.get<{ Querystring: { wallet?: string } }>(
    '/v1/waitlist/status',
    {
      schema: {
        description:
          'Public — coarse waitlist status for a wallet. Never discloses negative decisions (rejected/revoked read as pending).',
        tags: ['access'],
        querystring: {
          type: 'object',
          properties: { wallet: { type: 'string', minLength: 56, maxLength: 56 } },
          required: ['wallet'],
        },
        response: {
          200: {
            type: 'object',
            properties: { status: { type: 'string', enum: ['approved', 'pending', 'none'] } },
            required: ['status'],
          },
        },
      },
    },
    async (req, reply) => {
      const wallet = req.query.wallet ?? '';
      if (!StrKey.isValidEd25519PublicKey(wallet)) {
        return reply.code(400).send({ error: 'invalid_wallet' });
      }
      return reply.send({ status: await deps.access.status(wallet) });
    },
  );

  app.post<{ Body: { address: string } }>(
    '/v1/access/challenge',
    {
      schema: {
        description: 'Issue a one-time challenge the wallet signs to unlock the gated app.',
        tags: ['access'],
        body: {
          type: 'object',
          properties: { address: { type: 'string', minLength: 56, maxLength: 56 } },
          required: ['address'],
        },
        response: {
          200: {
            type: 'object',
            properties: { challengeHex: { type: 'string' }, expiresAt: { type: 'integer' } },
            required: ['challengeHex', 'expiresAt'],
          },
        },
      },
    },
    async (req, reply) => reply.send(deps.walletAuth.issueChallenge(req.body.address)),
  );

  app.post<{ Body: VerifyBody }>(
    '/v1/access/verify',
    {
      schema: {
        description:
          'Verify a signed unlock challenge and confirm the wallet is approved. Consumed server-side by the web cookie route.',
        tags: ['access'],
        body: {
          type: 'object',
          properties: {
            address: { type: 'string', minLength: 56, maxLength: 56 },
            challenge: { type: 'string' },
            signature: { type: 'string' },
          },
          required: ['address', 'challenge', 'signature'],
        },
        response: {
          200: {
            type: 'object',
            properties: { approved: { type: 'boolean' }, wave: { type: ['string', 'null'] } },
            required: ['approved'],
          },
          401: ERROR_SCHEMA,
          403: ERROR_SCHEMA,
        },
      },
    },
    async (req, reply) => {
      const { address, challenge, signature } = req.body;
      if (!deps.walletAuth.verify(address, challenge, signature)) {
        return reply.code(401).send({ error: 'invalid_signature' });
      }
      if (!(await deps.access.isApproved(address))) {
        return reply.code(403).send({ error: 'not_approved' });
      }
      const grant = await deps.access.grantOf(address);
      return reply.send({ approved: true, wave: grant?.wave ?? null });
    },
  );

  app.get<{ Querystring: { status?: string; wave?: string; q?: string; limit?: number; offset?: number } }>(
    '/v1/admin/waitlist',
    {
      preHandler: [app.requireAuth, requireAdmin],
      schema: {
        description: 'Admin — list waitlist grants with filters + status counts.',
        tags: ['access'],
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'revoked'] },
            wave: { type: 'string', maxLength: 64 },
            q: { type: 'string', maxLength: 120 },
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: true,
            properties: {
              rows: { type: 'array', items: GRANT_SCHEMA },
              counts: { type: 'object', additionalProperties: true },
            },
            required: ['rows', 'counts'],
          },
          403: ERROR_SCHEMA,
        },
      },
    },
    async (req, reply) => {
      const { status, wave, q, limit, offset } = req.query;
      const rows = await deps.access.list({
        status: status as GrantStatus | undefined,
        wave,
        q,
        limit: limit ?? 100,
        offset: offset ?? 0,
      });
      return reply.send({ rows, counts: await deps.access.counts() });
    },
  );

  app.post<{ Body: DecideBody }>(
    '/v1/admin/waitlist/decide',
    {
      preHandler: [app.requireAuth, requireAdmin],
      schema: {
        description:
          'Admin — batch approve/reject/revoke. Approvals may add wallets that never joined; every change is audit-logged and approval emails fire (never blocking).',
        tags: ['access'],
        body: {
          type: 'object',
          properties: {
            wallets: {
              type: 'array',
              items: { type: 'string', minLength: 56, maxLength: 56 },
              minItems: 1,
              maxItems: 200,
            },
            action: { type: 'string', enum: ['approve', 'reject', 'revoke'] },
            wave: { type: 'string', maxLength: 64 },
            notes: { type: 'string', maxLength: 500 },
          },
          required: ['wallets', 'action'],
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: true,
            properties: {
              updated: { type: 'array', items: { type: 'string' } },
              emailed: { type: 'array', items: { type: 'string' } },
            },
            required: ['updated'],
          },
          400: ERROR_SCHEMA,
          403: ERROR_SCHEMA,
        },
      },
    },
    async (req, reply) => {
      const { wallets, action, wave, notes } = req.body;
      if (!ACTIONS.has(action as GrantAction)) {
        return reply.code(400).send({ error: 'invalid_action' });
      }
      for (const w of wallets) {
        if (!StrKey.isValidEd25519PublicKey(w)) {
          return reply.code(400).send({ error: 'invalid_wallet', message: w });
        }
      }
      const actor = req.user!.owner;
      const { updated } = await deps.access.decide({
        wallets,
        action: action as GrantAction,
        wave,
        notes,
        actor,
      });

      // Approval emails: strictly after the committed decision, never
      // blocking it — a failed send just leaves email_sent_at null.
      const emailed: string[] = [];
      if (action === 'approve') {
        for (const wallet of updated) {
          const grant = await deps.access.grantOf(wallet);
          if (!grant?.email || grant.emailSentAt) continue;
          if (await deps.emailer.sendApproval(grant.email, grant.wave)) {
            await deps.access.markEmailSent(wallet);
            emailed.push(wallet);
          }
        }
      }
      return reply.send({ updated, emailed });
    },
  );

  app.get<{ Querystring: { status?: string } }>(
    '/v1/admin/waitlist/export.csv',
    {
      preHandler: [app.requireAuth, requireAdmin],
      schema: {
        description: 'Admin — CSV export of grants (the export itself is audit-logged).',
        tags: ['access'],
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'revoked'] },
          },
        },
      },
    },
    async (req, reply) => {
      const status = req.query.status;
      if (status !== undefined && !STATUSES.has(status as GrantStatus)) {
        return reply.code(400).send({ error: 'invalid_status' });
      }
      const rows = await deps.access.list({
        status: status as GrantStatus | undefined,
        limit: 10_000,
        offset: 0,
      });
      await deps.access.audit(req.user!.owner, 'export', null, { status: status ?? 'all', rows: rows.length });
      const esc = (v: string | null): string =>
        v == null ? '' : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      const csv = [
        'wallet,email,status,source,wave,segment,requested_at,decided_at,decided_by,notes',
        ...rows.map((r) =>
          [r.wallet, r.email, r.status, r.source, r.wave, r.segment, r.requestedAt, r.decidedAt, r.decidedBy, r.notes]
            .map(esc)
            .join(','),
        ),
      ].join('\n');
      return reply.header('content-type', 'text/csv; charset=utf-8').send(csv);
    },
  );
}
