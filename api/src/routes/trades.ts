import type { FastifyInstance } from 'fastify';
import type { StatsService } from '../services/stats.js';

interface TradesQuery {
  trader?: string;
  asset?: string;
  before_ts?: number;
  limit?: number;
}

const TRADE_SCHEMA = {
  type: 'object',
  properties: {
    positionId: { type: 'integer' },
    trader: { type: 'string' },
    kind: { type: 'string', enum: ['close', 'liquidation'] },
    asset: { type: ['string', 'null'] },
    direction: { type: ['integer', 'null'] },
    size: { type: ['string', 'null'] },
    entryPrice: { type: ['string', 'null'] },
    closePrice: { type: ['string', 'null'] },
    pnl: { type: ['string', 'null'] },
    ledger: { type: 'integer' },
    ts: { type: 'integer' },
    txHash: { type: 'string' },
  },
  required: ['positionId', 'trader', 'kind', 'ledger', 'ts', 'txHash'],
} as const;

export async function registerTradesRoutes(
  app: FastifyInstance,
  stats: StatsService,
): Promise<void> {
  app.get<{ Querystring: TradesQuery }>(
    '/v1/trades',
    {
      schema: {
        description:
          'Recent realized trades (position_closed / position_liquidated events), newest first. ' +
          'Size, asset, direction, and entry price are joined from the matching position_opened ' +
          'event; null when the open predates the indexer history.',
        tags: ['markets'],
        querystring: {
          type: 'object',
          properties: {
            trader: { type: 'string', minLength: 56, maxLength: 56 },
            asset: { type: 'string', minLength: 1, maxLength: 12 },
            before_ts: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: { trades: { type: 'array', items: TRADE_SCHEMA } },
            required: ['trades'],
          },
        },
      },
    },
    async (req, reply) => {
      const trades = await stats.recentTrades({
        trader: req.query.trader,
        asset: req.query.asset?.toUpperCase(),
        beforeTs: req.query.before_ts,
        limit: req.query.limit,
      });
      return reply.send({ trades });
    },
  );
}
