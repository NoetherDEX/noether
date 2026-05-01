import type { FastifyInstance } from 'fastify';
import { isSupportedAsset } from '@noether/shared';
import type { OracleService } from '../services/oracle.js';

interface AssetParam {
  asset: string;
}

export async function registerOracleRoutes(
  app: FastifyInstance,
  oracle: OracleService,
): Promise<void> {
  app.get(
    '/v1/oracle/prices',
    {
      schema: {
        description: 'All supported asset prices read live from the mock_oracle contract.',
        tags: ['oracle'],
      },
    },
    async (_req, reply) => {
      const prices = await oracle.getAllPrices();
      return reply.send({
        prices: prices.map((p) => ({
          asset: p.asset,
          price: p.price.toString(),
          priceFloat: p.priceFloat,
          timestamp: p.timestamp,
        })),
      });
    },
  );

  app.get<{ Params: AssetParam }>(
    '/v1/markets/:asset/price',
    {
      schema: {
        description: 'Current oracle price for a single asset.',
        tags: ['oracle'],
        params: {
          type: 'object',
          properties: { asset: { type: 'string' } },
          required: ['asset'],
        },
      },
    },
    async (req, reply) => {
      const symbol = req.params.asset.toUpperCase();
      if (!isSupportedAsset(symbol)) {
        return reply.code(404).send({ error: 'Unknown asset', asset: symbol });
      }
      const price = await oracle.getPrice(symbol);
      return reply.send({
        asset: price.asset,
        price: price.price.toString(),
        priceFloat: price.priceFloat,
        timestamp: price.timestamp,
      });
    },
  );
}
