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
    trades: { type: 'integer' },
    liqCount: { type: 'integer' },
  },
  required: ['trader', 'pnl', 'volume', 'trades', 'liqCount'],
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
          'Trader leaderboard from the indexer projections, scoped to the current market ' +
          'deployment and merged with the pre-2026-07 legacy baseline. Rank by realized ' +
          'PnL (`sort=pnl`, default) or traded notional (`sort=volume`). `updatedAt` is ' +
          'when the index last advanced (unix seconds). Durable replacement for the web ' +
          'cron that re-scanned Horizon.',
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
              updatedAt: { type: ['integer', 'null'] },
              leaders: { type: 'array', items: LEADER_SCHEMA },
            },
            required: ['sort', 'updatedAt', 'leaders'],
          },
        },
      },
    },
    async (req, reply) => {
      const sort: LeaderboardSort = req.query.sort === 'volume' ? 'volume' : 'pnl';
      const board = await stats.leaderboard({ sort, limit: req.query.limit });
      return reply.send({ sort, updatedAt: board.updatedAt, leaders: board.leaders });
    },
  );

  app.get(
    '/v1/leaderboard/totals',
    {
      schema: {
        description:
          'Market-wide headline totals (distinct traders, traded notional, trade count), ' +
          'aggregated in SQL over EVERY trader rather than the ranked page. Summing ' +
          '`/v1/leaderboard` undercounts once distinct traders exceed the page limit: the ' +
          'count pins at the limit and the tail stops contributing. Same scoping and legacy ' +
          'baseline as `/v1/leaderboard`.',
        tags: ['markets'],
        response: {
          200: {
            type: 'object',
            properties: {
              updatedAt: { type: ['integer', 'null'] },
              traders: { type: 'integer' },
              volume: { type: 'string' },
              trades: { type: 'integer' },
            },
            required: ['updatedAt', 'traders', 'volume', 'trades'],
          },
        },
      },
    },
    async (_req, reply) => {
      const totals = await stats.leaderboardTotals();
      return reply.send(totals);
    },
  );
}
