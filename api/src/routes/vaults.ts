import type { FastifyInstance } from 'fastify';
import type { VaultsService } from '../services/vaults.js';

interface IdParam {
  id: number;
}

interface ListQuery {
  leader?: string;
  limit?: number;
}

interface ActivityQuery {
  limit?: number;
}

export async function registerVaultRoutes(
  app: FastifyInstance,
  vaults: VaultsService,
): Promise<void> {
  app.get<{ Querystring: ListQuery }>(
    '/v1/vaults',
    {
      schema: {
        description: 'List all vaults the indexer knows about (newest first). Filter by `leader`.',
        tags: ['vaults'],
        querystring: {
          type: 'object',
          properties: {
            leader: { type: 'string', minLength: 56, maxLength: 56 },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const rows = await vaults.list({ leader: req.query.leader, limit: req.query.limit });
      return reply.send({ vaults: rows });
    },
  );

  app.get<{ Params: IdParam }>(
    '/v1/vaults/:id',
    {
      schema: {
        description: 'Detailed view of a single vault.',
        tags: ['vaults'],
        params: {
          type: 'object',
          properties: { id: { type: 'integer', minimum: 0 } },
          required: ['id'],
        },
      },
    },
    async (req, reply) => {
      const row = await vaults.get(req.params.id);
      if (!row) return reply.code(404).send({ error: 'vault_not_found', id: req.params.id });
      return reply.send(row);
    },
  );

  app.get<{ Params: IdParam; Querystring: ActivityQuery }>(
    '/v1/vaults/:id/deposits',
    {
      schema: {
        description: 'Deposit history for a vault, newest first.',
        tags: ['vaults'],
        params: {
          type: 'object',
          properties: { id: { type: 'integer', minimum: 0 } },
          required: ['id'],
        },
        querystring: {
          type: 'object',
          properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } },
        },
      },
    },
    async (req, reply) => {
      const rows = await vaults.deposits(req.params.id, req.query.limit);
      return reply.send({ deposits: rows });
    },
  );

  app.get<{ Params: IdParam; Querystring: ActivityQuery }>(
    '/v1/vaults/:id/withdraws',
    {
      schema: {
        description: 'Withdraw history for a vault, newest first.',
        tags: ['vaults'],
        params: {
          type: 'object',
          properties: { id: { type: 'integer', minimum: 0 } },
          required: ['id'],
        },
        querystring: {
          type: 'object',
          properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } },
        },
      },
    },
    async (req, reply) => {
      const rows = await vaults.withdraws(req.params.id, req.query.limit);
      return reply.send({ withdraws: rows });
    },
  );

  app.get<{ Params: IdParam; Querystring: ActivityQuery }>(
    '/v1/vaults/:id/fee-claims',
    {
      schema: {
        description: 'Leader profit-share claim history for a vault.',
        tags: ['vaults'],
        params: {
          type: 'object',
          properties: { id: { type: 'integer', minimum: 0 } },
          required: ['id'],
        },
        querystring: {
          type: 'object',
          properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } },
        },
      },
    },
    async (req, reply) => {
      const rows = await vaults.feeClaims(req.params.id, req.query.limit);
      return reply.send({ feeClaims: rows });
    },
  );
}
