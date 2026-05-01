import type { FastifyInstance } from 'fastify';
import type { MarketsService } from '../services/markets.js';

interface AssetParam {
  asset: string;
}

export async function registerMarketsRoutes(
  app: FastifyInstance,
  service: MarketsService,
): Promise<void> {
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
