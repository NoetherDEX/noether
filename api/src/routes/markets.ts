import type { FastifyInstance } from 'fastify';
import type { MarketsService } from '../services/markets.js';
import type { StatsService } from '../services/stats.js';

interface AssetParam {
  asset: string;
}

const ASSET_STATS_SCHEMA = {
  type: 'object',
  properties: {
    asset: { type: 'string' },
    openInterestLong: { type: 'string' },
    openInterestShort: { type: 'string' },
    openInterestNet: { type: 'string' },
    openPositions: { type: 'integer' },
    volume24h: { type: 'string' },
  },
  required: [
    'asset',
    'openInterestLong',
    'openInterestShort',
    'openInterestNet',
    'openPositions',
    'volume24h',
  ],
} as const;

export async function registerMarketsRoutes(
  app: FastifyInstance,
  service: MarketsService,
  stats: StatsService,
): Promise<void> {
  app.get(
    '/v1/markets/stats',
    {
      schema: {
        description:
          'Per-asset open interest (long / short / net, from the open-positions projection) and ' +
          '24h traded volume (position_opened + realized position_closed / liquidated notional). ' +
          'All amounts are i128 decimal strings with 7-decimal USDC precision.',
        tags: ['markets'],
        response: {
          200: {
            type: 'object',
            properties: {
              stats: { type: 'array', items: ASSET_STATS_SCHEMA },
            },
            required: ['stats'],
          },
        },
      },
    },
    async (_req, reply) => {
      return reply.send({ stats: await stats.marketStats() });
    },
  );

  app.get(
    '/v1/markets',
    {
      schema: {
        description: 'List all supported markets with current oracle prices.',
        tags: ['markets'],
        response: {
          200: {
            type: 'object',
            properties: {
              markets: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    asset: {
                      type: 'object',
                      properties: {
                        symbol: { type: 'string' },
                        name: { type: 'string' },
                        decimals: { type: 'integer' },
                      },
                      required: ['symbol', 'name', 'decimals'],
                    },
                    oracle: {
                      type: 'object',
                      properties: {
                        asset: { type: 'string' },
                        price: { type: 'string' },
                        priceFloat: { type: 'number' },
                        timestamp: { type: 'integer' },
                      },
                      required: ['asset', 'price', 'priceFloat', 'timestamp'],
                    },
                  },
                  required: ['asset', 'oracle'],
                },
              },
            },
            required: ['markets'],
          },
        },
      },
    },
    async (_req, reply) => {
      const summaries = await service.summaries();
      return reply.send({
        markets: summaries.map((s) => ({
          asset: s.asset,
          oracle: {
            asset: s.oracle.asset,
            price: s.oracle.price.toString(),
            priceFloat: s.oracle.priceFloat,
            timestamp: s.oracle.timestamp,
          },
        })),
      });
    },
  );

  app.get<{ Params: AssetParam }>(
    '/v1/markets/:asset',
    {
      schema: {
        description: 'Single market detail with current oracle price.',
        tags: ['markets'],
        params: {
          type: 'object',
          properties: { asset: { type: 'string' } },
          required: ['asset'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              asset: {
                type: 'object',
                properties: {
                  symbol: { type: 'string' },
                  name: { type: 'string' },
                  decimals: { type: 'integer' },
                },
                required: ['symbol', 'name', 'decimals'],
              },
              oracle: {
                type: 'object',
                properties: {
                  asset: { type: 'string' },
                  price: { type: 'string' },
                  priceFloat: { type: 'number' },
                  timestamp: { type: 'integer' },
                },
                required: ['asset', 'price', 'priceFloat', 'timestamp'],
              },
            },
            required: ['asset', 'oracle'],
          },
          404: {
            type: 'object',
            additionalProperties: true,
            properties: {
              error: { type: 'string' },
              asset: { type: 'string' },
            },
            required: ['error'],
          },
        },
      },
    },
    async (req, reply) => {
      const symbol = req.params.asset.toUpperCase();
      const summary = await service.summary(symbol);
      if (!summary) {
        return reply.code(404).send({ error: 'Unknown asset', asset: symbol });
      }
      return reply.send({
        asset: summary.asset,
        oracle: {
          asset: summary.oracle.asset,
          price: summary.oracle.price.toString(),
          priceFloat: summary.oracle.priceFloat,
          timestamp: summary.oracle.timestamp,
        },
      });
    },
  );
}
