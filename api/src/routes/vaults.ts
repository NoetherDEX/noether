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
  before_ts?: number;
}

const VAULT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: { type: 'integer' },
    leader: { type: 'string' },
    name: { type: 'string' },
    createdAt: { type: 'integer' },
    totalUsdc: { type: 'string' },
    circulatingShares: { type: 'string' },
    hwmNav: { type: 'string' },
    realizedPnl: { type: 'string' },
    leaderShares: { type: 'string' },
    profitShareBps: { type: 'integer' },
    paused: { type: 'boolean' },
    updatedAt: { type: 'integer' },
    depositorCount: { type: 'integer' },
    openPositions: { type: 'integer' },
    tradeCount: { type: 'integer' },
    drawdownBps: { type: 'integer' },
    apyBps: { type: 'integer' },
    closedTradePnl: { type: 'string' },
  },
  required: ['id', 'leader', 'name', 'createdAt', 'totalUsdc', 'circulatingShares'],
} as const;

const VAULT_TRADE_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: { type: 'integer' },
    vaultId: { type: 'integer' },
    positionId: { type: 'string' },
    action: { type: 'string', enum: ['open', 'close'] },
    leader: { type: 'string' },
    collateral: { type: 'string' },
    pnl: { type: ['string', 'null'] },
    ledger: { type: 'integer' },
    ts: { type: 'integer' },
    txHash: { type: 'string' },
  },
  required: ['id', 'vaultId', 'positionId', 'action', 'leader', 'collateral', 'ledger', 'ts', 'txHash'],
} as const;

const VAULT_ACTIVITY_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: { type: 'integer' },
    vaultId: { type: 'integer' },
    principal: { type: 'string' },
    amount: { type: 'string' },
    shares: { type: 'string' },
    ledger: { type: 'integer' },
    ts: { type: 'integer' },
    txHash: { type: 'string' },
  },
  required: ['id', 'vaultId', 'principal', 'amount', 'ledger', 'ts', 'txHash'],
} as const;

const VAULT_NOT_FOUND_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    error: { type: 'string' },
    id: { type: 'integer' },
  },
  required: ['error'],
} as const;

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
        response: {
          200: {
            type: 'object',
            properties: { vaults: { type: 'array', items: VAULT_SCHEMA } },
            required: ['vaults'],
          },
        },
      },
    },
    async (req, reply) => {
      const rows = await vaults.list({ leader: req.query.leader, limit: req.query.limit });
      // Enrich every card with depositor / trade aggregates so the
      // marketplace UI can render APY / drawdown / depositor count
      // without N+1 fetches.
      const enriched = await Promise.all(
        rows.map(async (r) => {
          const agg = await vaults.aggregates(r.id, r);
          return { ...r, ...agg };
        }),
      );
      return reply.send({ vaults: enriched });
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
        response: {
          200: VAULT_SCHEMA,
          404: VAULT_NOT_FOUND_SCHEMA,
        },
      },
    },
    async (req, reply) => {
      const row = await vaults.get(req.params.id);
      if (!row) return reply.code(404).send({ error: 'vault_not_found', id: req.params.id });
      const agg = await vaults.aggregates(req.params.id, row);
      return reply.send({ ...row, ...agg });
    },
  );

  app.get<{ Params: IdParam; Querystring: ActivityQuery }>(
    '/v1/vaults/:id/trades',
    {
      schema: {
        description:
          'Leader open/close trade history for a vault, newest first. Each row records a leader_open or leader_close event emitted by the vault_factory contract.',
        tags: ['vaults'],
        params: {
          type: 'object',
          properties: { id: { type: 'integer', minimum: 0 } },
          required: ['id'],
        },
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 200 },
            before_ts: { type: 'integer', minimum: 0 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: { trades: { type: 'array', items: VAULT_TRADE_SCHEMA } },
            required: ['trades'],
          },
        },
      },
    },
    async (req, reply) => {
      const rows = await vaults.trades(req.params.id, {
        limit: req.query.limit,
        beforeTs: req.query.before_ts,
      });
      return reply.send({ trades: rows });
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
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 200 },
            before_ts: { type: 'integer', minimum: 0 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: { deposits: { type: 'array', items: VAULT_ACTIVITY_SCHEMA } },
            required: ['deposits'],
          },
        },
      },
    },
    async (req, reply) => {
      const rows = await vaults.deposits(req.params.id, {
        limit: req.query.limit,
        beforeTs: req.query.before_ts,
      });
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
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 200 },
            before_ts: { type: 'integer', minimum: 0 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: { withdraws: { type: 'array', items: VAULT_ACTIVITY_SCHEMA } },
            required: ['withdraws'],
          },
        },
      },
    },
    async (req, reply) => {
      const rows = await vaults.withdraws(req.params.id, {
        limit: req.query.limit,
        beforeTs: req.query.before_ts,
      });
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
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 200 },
            before_ts: { type: 'integer', minimum: 0 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: { feeClaims: { type: 'array', items: VAULT_ACTIVITY_SCHEMA } },
            required: ['feeClaims'],
          },
        },
      },
    },
    async (req, reply) => {
      const rows = await vaults.feeClaims(req.params.id, {
        limit: req.query.limit,
        beforeTs: req.query.before_ts,
      });
      return reply.send({ feeClaims: rows });
    },
  );
}
