import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ReferralReadService } from '../services/referral.js';

interface LookupQuery {
  code: string;
}

interface ActivityQuery {
  limit?: number;
}

export async function registerReferralRoutes(
  app: FastifyInstance,
  service: ReferralReadService,
): Promise<void> {
  app.get<{ Querystring: LookupQuery }>(
    '/v1/referral/lookup',
    {
      schema: {
        description: 'Resolve a referral code to its referrer (public).',
        tags: ['referral'],
        querystring: {
          type: 'object',
          properties: { code: { type: 'string', minLength: 3, maxLength: 16 } },
          required: ['code'],
        },
      },
    },
    async (req, reply) => {
      const row = await service.lookupCode(req.query.code);
      if (!row) return reply.code(404).send({ error: 'unknown_code', code: req.query.code });
      return reply.send(row);
    },
  );

  app.get(
    '/v1/referral/me',
    {
      preHandler: app.requireAuth,
      schema: {
        description:
          'Returns the referral state of the authenticated owner — both their own referrer row (if any) and the binding they hold as a referee (if any).',
        tags: ['referral', 'account'],
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const owner = req.user!.owner;
      const [self, binding] = await Promise.all([
        service.getReferrerByAddress(owner),
        service.getBindingForReferee(owner),
      ]);
      return reply.send({ self, binding });
    },
  );

  app.get<{ Querystring: ActivityQuery }>(
    '/v1/referral/me/trades',
    {
      preHandler: app.requireAuth,
      schema: {
        description: 'Trades the authenticated owner has earned referral fees on.',
        tags: ['referral', 'account'],
        querystring: {
          type: 'object',
          properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } },
        },
      },
    },
    async (req, reply) => {
      const trades = await service.tradesForReferrer(req.user!.owner, req.query.limit);
      return reply.send({ trades });
    },
  );

  app.get<{ Querystring: ActivityQuery }>(
    '/v1/referral/me/claims',
    {
      preHandler: app.requireAuth,
      schema: {
        description: 'Claim history for the authenticated owner as referrer.',
        tags: ['referral', 'account'],
        querystring: {
          type: 'object',
          properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } },
        },
      },
    },
    async (req, reply) => {
      const claims = await service.claimsForReferrer(req.user!.owner, req.query.limit);
      return reply.send({ claims });
    },
  );
}
