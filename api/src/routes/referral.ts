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

const REFERRER_PROPERTIES = {
  referrer: { type: 'string' },
  code: { type: 'string' },
  createdAt: { type: 'integer' },
  referredCount: { type: 'integer' },
  totalVolumeGenerated: { type: 'string' },
  totalEarned: { type: 'string' },
  claimable: { type: 'string' },
  updatedAt: { type: 'integer' },
} as const;

const REFERRER_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: REFERRER_PROPERTIES,
  required: ['referrer', 'code'],
} as const;

const NULLABLE_REFERRER_SCHEMA = {
  type: ['object', 'null'],
  additionalProperties: true,
  properties: REFERRER_PROPERTIES,
} as const;

const NULLABLE_BINDING_SCHEMA = {
  type: ['object', 'null'],
  additionalProperties: true,
  properties: {
    referee: { type: 'string' },
    referrer: { type: 'string' },
    code: { type: 'string' },
    boundAt: { type: 'integer' },
    txHash: { type: 'string' },
  },
} as const;

const REFERRAL_TRADE_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: { type: 'integer' },
    referee: { type: 'string' },
    referrer: { type: 'string' },
    originalFee: { type: 'string' },
    discount: { type: 'string' },
    payout: { type: 'string' },
    ledger: { type: 'integer' },
    ts: { type: 'integer' },
    txHash: { type: 'string' },
  },
  required: ['id', 'referee', 'referrer', 'ledger', 'ts', 'txHash'],
} as const;

const REFERRAL_CLAIM_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: { type: 'integer' },
    referrer: { type: 'string' },
    amount: { type: 'string' },
    ledger: { type: 'integer' },
    ts: { type: 'integer' },
    txHash: { type: 'string' },
  },
  required: ['id', 'referrer', 'amount', 'ledger', 'ts', 'txHash'],
} as const;

const NOT_FOUND_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    error: { type: 'string' },
    code: { type: 'string' },
    address: { type: 'string' },
  },
  required: ['error'],
} as const;

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
        response: {
          200: REFERRER_SCHEMA,
          404: NOT_FOUND_SCHEMA,
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
        response: {
          200: {
            type: 'object',
            properties: {
              self: REFERRER_SCHEMA,
              binding: NULLABLE_BINDING_SCHEMA,
            },
            required: ['self'],
          },
          404: NOT_FOUND_SCHEMA,
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
        response: {
          200: {
            type: 'object',
            properties: {
              self: NULLABLE_REFERRER_SCHEMA,
              binding: NULLABLE_BINDING_SCHEMA,
            },
          },
        },
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
        response: {
          200: {
            type: 'object',
            properties: { trades: { type: 'array', items: REFERRAL_TRADE_SCHEMA } },
            required: ['trades'],
          },
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
        response: {
          200: {
            type: 'object',
            properties: { claims: { type: 'array', items: REFERRAL_CLAIM_SCHEMA } },
            required: ['claims'],
          },
        },
      },
    },
    async (req, reply) => {
      const claims = await service.claimsForReferrer(req.user!.owner, req.query.limit);
      return reply.send({ claims });
    },
  );
}
