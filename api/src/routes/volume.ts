import type { FastifyInstance } from 'fastify';
import type { StatsService } from '../services/stats.js';

interface VolumeQuery {
  address: string;
}

export async function registerVolumeRoutes(
  app: FastifyInstance,
  stats: StatsService,
): Promise<void> {
  app.get<{ Querystring: VolumeQuery }>(
    '/v1/account/volume',
    {
      schema: {
        description:
          'Trailing 14-day traded notional for a wallet (public). Sums position size over ' +
          'position_opened and position_closed events in the window — mirrors the market ' +
          "contract's rolling VolumeRecord used for fee tiers (liquidations record no volume). " +
          'Feeds the OrderPanel fee-tier preview.',
        tags: ['account'],
        querystring: {
          type: 'object',
          properties: { address: { type: 'string', minLength: 56, maxLength: 56 } },
          required: ['address'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              address: { type: 'string' },
              volume14d: {
                type: 'string',
                description: 'i128 decimal string, 7-decimal USDC notional',
              },
            },
            required: ['address', 'volume14d'],
          },
        },
      },
    },
    async (req, reply) => {
      const volume = await stats.traderVolume14d(req.query.address);
      return reply.send({ address: req.query.address, volume14d: volume.toString() });
    },
  );
}
