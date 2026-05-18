import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ReferralReadService } from '../services/referral.js';

interface LookupQuery {
  code: string;
}

interface InfoQuery {
  address: string;
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

  app.get<{ Querystring: InfoQuery }>(
    '/v1/referral/info',
    {
      schema: {
        description:
          'Look up a referrer profile by Stellar address (public). Returns the row from the referrers projection table, or 404 if the address has never registered a code. Same shape as /v1/referral/me, just queried by address instead of by authed owner.',
        tags: ['referral'],
        querystring: {
          type: 'object',
          properties: { address: { type: 'string', minLength: 56, maxLength: 56 } },
          required: ['address'],
        },
      },
    },
    async (req, reply) => {
      const row = await service.getReferrerByAddress(req.query.address);
      if (!row) return reply.code(404).send({ error: 'no_code', address: req.query.address });
      const binding = await service.getBindingForReferee(req.query.address);
      return reply.send({ self: row, binding });
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
