import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiKeyStore } from '../services/apiKeys.js';
import type { AccessGrantsService } from '../services/accessGrants.js';
import type { WalletAuth } from '../services/walletAuth.js';

/**
 * Closed-beta allowlist. Returns the set of approved Stellar addresses
 * derived from the `API_KEY_ALLOWLIST` env var (comma-separated).
 * If the env var is empty or unset, key issuance is open to anyone —
 * useful for local dev + testnet. Production should always set this.
 *
 * Workstream A transition: when the env gate is active, a wallet passes if
 * it is on the env list OR approved in access_grants (the admin-panel
 * source of truth). The env var retires once the DB migration is verified.
 */
function loadAllowlist(): Set<string> | null {
  const raw = process.env.API_KEY_ALLOWLIST?.trim();
  if (!raw) return null;
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length === 56 && s.startsWith('G')),
  );
}

/** Active keys one wallet may hold at once. Override with API_MAX_KEYS_PER_OWNER. */
const MAX_KEYS_PER_OWNER = Number(process.env.API_MAX_KEYS_PER_OWNER ?? 5);

/**
 * Labels that behave as single-active session keys: issuing under one of
 * these first retires the owner's previous keys with the same label. The
 * admin panel mints one per sign-in, and without this the fifth sign-in
 * locks the wallet out of its own admin page (key_limit_reached).
 */
const SESSION_KEY_LABELS = new Set(['admin-panel']);

const ALLOWLIST = loadAllowlist();

interface ChallengeBody {
  address: string;
}

interface CreateKeyBody {
  address: string;
  challenge: string;
  signature: string;
  label?: string;
}

interface KeyIdParam {
  keyId: string;
}

const KEY_RECORD_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    keyId: { type: 'string' },
    owner: { type: 'string' },
    tier: { type: 'string' },
    label: { type: ['string', 'null'] },
    createdAt: { type: 'integer' },
    lastUsedAt: { type: ['integer', 'null'] },
    revokedAt: { type: ['integer', 'null'] },
  },
  required: ['keyId', 'owner', 'tier', 'createdAt'],
} as const;

const ERROR_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
  },
  required: ['error'],
} as const;

export async function registerKeyRoutes(
  app: FastifyInstance,
  apiKeys: ApiKeyStore,
  wallet: WalletAuth,
  access: AccessGrantsService,
  adminWallets: string[] = [],
): Promise<void> {
  const adminSet = new Set(adminWallets);
  app.get(
    '/v1/keys/beta-status',
    {
      schema: {
        description:
          'Public — reports whether key issuance is currently gated to a closed-beta allowlist, and optionally whether the supplied address is on it.',
        tags: ['keys'],
        querystring: {
          type: 'object',
          properties: { address: { type: 'string', minLength: 56, maxLength: 56 } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              gated: { type: 'boolean' },
              allowed: { type: 'boolean' },
            },
            required: ['gated', 'allowed'],
          },
        },
      },
    },
    async (req, reply) => {
      const address = (req.query as { address?: string }).address;
      const gated = ALLOWLIST !== null;
      const allowed =
        !gated ||
        (address
          ? ALLOWLIST!.has(address) || adminSet.has(address) || (await access.isApproved(address))
          : false);
      return reply.send({ gated, allowed });
    },
  );

  app.post<{ Body: ChallengeBody }>(
    '/v1/keys/challenge',
    {
      schema: {
        description: 'Issue a one-time challenge string the wallet must sign before an API key can be created.',
        tags: ['keys'],
        body: {
          type: 'object',
          properties: { address: { type: 'string', minLength: 56, maxLength: 56 } },
          required: ['address'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              challengeHex: { type: 'string' },
              expiresAt: { type: 'integer' },
            },
            required: ['challengeHex', 'expiresAt'],
          },
        },
      },
    },
    async (req, reply) => {
      const challenge = wallet.issueChallenge(req.body.address);
      return reply.send(challenge);
    },
  );

  app.post<{ Body: CreateKeyBody }>(
    '/v1/keys',
    {
      schema: {
        description: 'Exchange a signed challenge for a freshly minted API key + secret.',
        tags: ['keys'],
        body: {
          type: 'object',
          properties: {
            address: { type: 'string', minLength: 56, maxLength: 56 },
            challenge: { type: 'string' },
            signature: { type: 'string' },
            label: { type: 'string', maxLength: 64 },
          },
          required: ['address', 'challenge', 'signature'],
        },
        response: {
          201: {
            type: 'object',
            properties: {
              keyId: { type: 'string' },
              secret: { type: 'string' },
              tier: { type: 'string' },
              owner: { type: 'string' },
              createdAt: { type: 'integer' },
            },
            required: ['keyId', 'secret', 'tier', 'owner', 'createdAt'],
          },
          401: ERROR_SCHEMA,
          403: ERROR_SCHEMA,
        },
      },
    },
    async (req, reply) => {
      const { address, challenge, signature, label } = req.body;
      // Closed-beta gating — if an allowlist is configured, reject any
      // address that isn't on it before doing the (cheaper) signature
      // verification. Returns 403 so the UI can show a "not in beta"
      // message distinct from a bad signature.
      if (
        ALLOWLIST &&
        !ALLOWLIST.has(address) &&
        // ADMIN_WALLETS are inherently in the beta — without this, an admin
        // wallet cannot mint the session key that opens the very panel that
        // approves wallets (chicken-and-egg).
        !adminSet.has(address) &&
        !(await access.isApproved(address))
      ) {
        return reply.code(403).send({
          error: 'not_in_beta',
          message:
            'API key issuance is currently restricted to early-access wallets. ' +
            'Join the waitlist at noether.exchange to request access.',
        });
      }
      const ok = wallet.verify(address, challenge, signature);
      if (!ok) return reply.code(401).send({ error: 'invalid_signature' });

      if (label !== undefined && SESSION_KEY_LABELS.has(label)) {
        await apiKeys.revokeAllWithLabel(address, label);
      }

      // Checked only AFTER signature verification, so the endpoint cannot be
      // used to probe how many keys an arbitrary wallet holds.
      const active = await apiKeys.countActiveForOwner(address);
      if (active >= MAX_KEYS_PER_OWNER) {
        return reply.code(409).send({
          error: 'key_limit_reached',
          message:
            `This wallet already has ${active} active API keys (limit ${MAX_KEYS_PER_OWNER}). ` +
            'Revoke an unused key before issuing another.',
        });
      }

      const issued = await apiKeys.issue(address, label);
      return reply.code(201).send(issued);
    },
  );

  app.get(
    '/v1/keys',
    {
      preHandler: app.requireAuth,
      schema: {
        description: 'List all API keys owned by the authenticated key holder.',
        tags: ['keys'],
        response: {
          200: {
            type: 'object',
            properties: { keys: { type: 'array', items: KEY_RECORD_SCHEMA } },
            required: ['keys'],
          },
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const owner = req.user!.owner;
      const records = await apiKeys.listForOwner(owner);
      return reply.send({ keys: records });
    },
  );

  app.delete<{ Params: KeyIdParam }>(
    '/v1/keys/:keyId',
    {
      preHandler: app.requireAuth,
      schema: {
        description: 'Revoke an API key. Only the owner can revoke their own keys.',
        tags: ['keys'],
        params: {
          type: 'object',
          properties: { keyId: { type: 'string' } },
          required: ['keyId'],
        },
        response: {
          200: {
            type: 'object',
            properties: { revoked: { type: 'boolean' } },
            required: ['revoked'],
          },
          404: ERROR_SCHEMA,
        },
      },
    },
    async (req, reply) => {
      const owner = req.user!.owner;
      const ok = await apiKeys.revoke(req.params.keyId, owner);
      if (!ok) return reply.code(404).send({ error: 'key_not_found' });
      return reply.send({ revoked: true });
    },
  );
}
