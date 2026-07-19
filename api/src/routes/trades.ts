import type { FastifyInstance } from 'fastify';
import type { StatsService } from '../services/stats.js';

interface TradesQuery {
  trader?: string;
  asset?: string;
  before_ts?: number;
  limit?: number;
  include_opens?: boolean;
}

const TRADE_SCHEMA = {
  type: 'object',
  properties: {
    positionId: { type: ['integer', 'null'] },
    trader: { type: 'string' },
    kind: { type: 'string', enum: ['open', 'close', 'liquidation', 'cross_liquidation', 'adl'] },
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
          'Recent trades, newest first. Realized rows (position_closed / position_liquidated) ' +
          'carry size, asset, direction, and entry price joined from the matching position_opened ' +
          'event (null when the open predates the indexer history). Cross-margin account ' +
          'liquidations appear as kind:cross_liquidation with null position fields (the chain ' +
          'emits one account-level event; pnl is the account total) — omitted when filtering by ' +
          'asset. Auto-deleveraging fills appear as kind:adl (settled at the oracle mark, with ' +
          'per-position pnl). Pass include_opens=true to also receive position_opened rows as kind:open.',
        tags: ['markets'],
        querystring: {
          type: 'object',
          properties: {
            trader: { type: 'string', minLength: 56, maxLength: 56 },
            asset: { type: 'string', minLength: 1, maxLength: 12 },
            before_ts: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
            include_opens: { type: 'boolean' },
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
        includeOpens: req.query.include_opens === true,
      });
      return reply.send({ trades });
    },
  );
}
