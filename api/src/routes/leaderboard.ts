import type { FastifyInstance } from 'fastify';
import type { LeaderboardSort, StatsService } from '../services/stats.js';

interface LeaderboardQuery {
  sort?: LeaderboardSort;
  limit?: number;
}

const LEADER_SCHEMA = {
  type: 'object',
  properties: {
    trader: { type: 'string' },
    pnl: { type: 'string' },
    volume: { type: 'string' },
  },
  required: ['trader', 'pnl', 'volume'],
} as const;

export async function registerLeaderboardRoutes(
  app: FastifyInstance,
  stats: StatsService,
): Promise<void> {
  app.get<{ Querystring: LeaderboardQuery }>(
    '/v1/leaderboard',
    {
      schema: {
        description:
          'Trader leaderboard from the indexer projections. Rank by lifetime realized ' +
          'PnL (`sort=pnl`, default) or traded notional (`sort=volume`). Durable replacement ' +
          'for the web cron that re-scanned Horizon.',
        tags: ['markets'],
        querystring: {
          type: 'object',
          properties: {
            sort: { type: 'string', enum: ['pnl', 'volume'] },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              sort: { type: 'string', enum: ['pnl', 'volume'] },
              leaders: { type: 'array', items: LEADER_SCHEMA },
            },
            required: ['sort', 'leaders'],
          },
        },
      },
    },
    async (req, reply) => {
      const sort: LeaderboardSort = req.query.sort === 'volume' ? 'volume' : 'pnl';
      const leaders = await stats.leaderboard({ sort, limit: req.query.limit });
      return reply.send({ sort, leaders });
    },
  );
}
