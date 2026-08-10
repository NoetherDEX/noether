import type { FastifyInstance } from 'fastify';
import type { LeaderboardSort, StatsService } from '../services/stats.js';

interface LeaderboardQuery {
  scope?: string;
  sort?: LeaderboardSort;
  limit?: number;
  offset?: number;
  snapshot?: string;
}

interface RankQuery {
  trader: string;
  scope?: string;
  sort?: LeaderboardSort;
}

const SCOPE_SCHEMA = { type: 'string', enum: ['testnet', 'mainnet'] } as const;
const STATE_SCHEMA = { type: 'string', enum: ['ok', 'empty', 'not_indexed_here'] } as const;

const LEADER_SCHEMA = {
  type: 'object',
  properties: {
    rank: { type: 'integer' },
    trader: { type: 'string' },
    pnl: { type: 'string' },
    volume: { type: 'string' },
    trades: { type: 'integer' },
    liqCount: { type: 'integer' },
  },
  required: ['rank', 'trader', 'pnl', 'volume', 'trades', 'liqCount'],
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
          'Trader leaderboard from the indexer projections, ranked in SQL per deployment ' +
          'scope. `scope` selects the venue (`testnet` today; `mainnet` stays empty until ' +
          'launch, and a scope from another Stellar network answers `not_indexed_here` with ' +
          'zero rows). Rank by realized PnL (`sort=pnl`, default) or traded notional ' +
          '(`sort=volume`); ties break on the other metric, then trader, so ranks are unique ' +
          'and pages never overlap. Pages slice an immutable snapshot: pass the returned ' +
          '`snapshot` id with the next `offset` to keep ranks stable while paging, and watch ' +
          '`snapshotChanged` for the moment the board recomputed underneath you. `updatedAt` ' +
          'is when the index last advanced (unix seconds).',
        tags: ['markets'],
        querystring: {
          type: 'object',
          properties: {
            scope: SCOPE_SCHEMA,
            sort: { type: 'string', enum: ['pnl', 'volume'] },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
            offset: { type: 'integer', minimum: 0 },
            snapshot: { type: 'string', maxLength: 128 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              sort: { type: 'string', enum: ['pnl', 'volume'] },
              scope: SCOPE_SCHEMA,
              network: { type: 'string' },
              state: STATE_SCHEMA,
              updatedAt: { type: ['integer', 'null'] },
              total: { type: 'integer' },
              limit: { type: 'integer' },
              offset: { type: 'integer' },
              snapshot: { type: 'string' },
              snapshotChanged: { type: 'boolean' },
              leaders: { type: 'array', items: LEADER_SCHEMA },
            },
            required: [
              'sort',
              'scope',
              'network',
              'state',
              'updatedAt',
              'total',
              'limit',
              'offset',
              'snapshot',
              'snapshotChanged',
              'leaders',
            ],
          },
        },
      },
    },
    async (req, reply) => {
      const page = await stats.leaderboardPage({
        scope: req.query.scope,
        sort: req.query.sort === 'volume' ? 'volume' : 'pnl',
        limit: req.query.limit,
        offset: req.query.offset,
        snapshot: req.query.snapshot,
      });
      return reply.send(page);
    },
  );

  app.get<{ Querystring: RankQuery }>(
    '/v1/leaderboard/rank',
    {
      schema: {
        description:
          "One trader's rank and row on the full board for a (scope, sort), looked up in " +
          'the same snapshot the board pages slice, so it is always consistent with the ' +
          'pages and costs no extra scan. `rank` is null when the trader is not on the board.',
        tags: ['markets'],
        querystring: {
          type: 'object',
          properties: {
            trader: { type: 'string', minLength: 56, maxLength: 56, pattern: '^G[A-Z2-7]{55}$' },
            scope: SCOPE_SCHEMA,
            sort: { type: 'string', enum: ['pnl', 'volume'] },
          },
          required: ['trader'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              trader: { type: 'string' },
              sort: { type: 'string', enum: ['pnl', 'volume'] },
              scope: SCOPE_SCHEMA,
              network: { type: 'string' },
              state: STATE_SCHEMA,
              rank: { type: ['integer', 'null'] },
              total: { type: 'integer' },
              snapshot: { type: 'string' },
              updatedAt: { type: ['integer', 'null'] },
              entry: { ...LEADER_SCHEMA, type: ['object', 'null'] },
            },
            required: [
              'trader',
              'sort',
              'scope',
              'network',
              'state',
              'rank',
              'total',
              'snapshot',
              'updatedAt',
              'entry',
            ],
          },
        },
      },
    },
    async (req, reply) => {
      const rank = await stats.leaderboardRank({
        trader: req.query.trader,
        scope: req.query.scope,
        sort: req.query.sort === 'volume' ? 'volume' : 'pnl',
      });
      return reply.send(rank);
    },
  );

  app.get<{ Querystring: { scope?: string } }>(
    '/v1/leaderboard/totals',
    {
      schema: {
        description:
          'Market wide headline totals (distinct traders, traded notional, trade count), ' +
          'aggregated in SQL over EVERY trader rather than the ranked page. Summing ' +
          '`/v1/leaderboard` undercounts once distinct traders exceed the page limit: the ' +
          'count pins at the limit and the tail stops contributing. Scoped like the board ' +
          '(same `scope` semantics), with the same legacy baseline slice.',
        tags: ['markets'],
        querystring: {
          type: 'object',
          properties: {
            scope: SCOPE_SCHEMA,
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              scope: SCOPE_SCHEMA,
              network: { type: 'string' },
              state: STATE_SCHEMA,
              updatedAt: { type: ['integer', 'null'] },
              traders: { type: 'integer' },
              volume: { type: 'string' },
              trades: { type: 'integer' },
            },
            required: ['scope', 'network', 'state', 'updatedAt', 'traders', 'volume', 'trades'],
          },
        },
      },
    },
    async (req, reply) => {
      const totals = await stats.leaderboardTotals({ scope: req.query.scope });
      return reply.send(totals);
    },
  );
}
