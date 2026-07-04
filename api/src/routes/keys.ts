import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiKeyStore } from '../services/apiKeys.js';
import type { WalletAuth } from '../services/walletAuth.js';

/**
 * Closed-beta allowlist. Returns the set of approved Stellar addresses
 * derived from the `API_KEY_ALLOWLIST` env var (comma-separated).
 * If the env var is empty or unset, key issuance is open to anyone —
 * useful for local dev + testnet. Production should always set this.
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
): Promise<void> {
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
      const allowed = !gated || (address ? ALLOWLIST!.has(address) : false);
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
      if (ALLOWLIST && !ALLOWLIST.has(address)) {
        return reply.code(403).send({
          error: 'not_in_beta',
          message:
            'API key issuance is currently restricted to early-access wallets. ' +
            'Contact the team to request access.',
        });
      }
      const ok = wallet.verify(address, challenge, signature);
      if (!ok) return reply.code(401).send({ error: 'invalid_signature' });
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
