import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiKeyStore } from '../services/apiKeys.js';
import type { WalletAuth } from '../services/walletAuth.js';

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

export async function registerKeyRoutes(
  app: FastifyInstance,
  apiKeys: ApiKeyStore,
  wallet: WalletAuth,
): Promise<void> {
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
      },
    },
    async (req, reply) => {
      const { address, challenge, signature, label } = req.body;
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
