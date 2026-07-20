import type { FastifyInstance } from 'fastify';
import type { AdlQueueService } from '../services/adlQueue.js';
import type { ShortfallService } from '../services/shortfall.js';

interface AdlQueueQuery {
  asset: string;
  trader?: string;
}

interface ShortfallQuery {
  address: string;
}

export async function registerAdlRoutes(
  app: FastifyInstance,
  adl: AdlQueueService,
  shortfall: ShortfallService,
): Promise<void> {
  app.get<{ Querystring: AdlQueueQuery }>(
    '/v1/adl/queue',
    {
      schema: {
        description:
          'Advisory auto-deleveraging queue for one asset (public): positive-pnl positions ' +
          'ranked by (pnl / collateral) × leverage, quintiles 1..5 (1 = first to be ' +
          'deleveraged if pool coverage fails). Positions are hydrated from ledger entries ' +
          'at the current oracle mark; 30s cache. degraded=true means the ranking could not ' +
          'be computed this window — unknown, not "nobody at risk".',
        tags: ['adl'],
        querystring: {
          type: 'object',
          properties: {
            asset: { type: 'string', minLength: 1, maxLength: 12 },
            trader: { type: 'string', minLength: 56, maxLength: 56 },
          },
          required: ['asset'],
        },
      },
    },
    async (req, reply) => {
      const asset = req.query.asset.trim().toUpperCase();
      const result = await adl.queue(asset);
      const rows = req.query.trader
        ? result.rows.filter((row) => row.trader === req.query.trader)
        : result.rows;
      return reply.send({ ...result, rows });
    },
  );

  app.get<{ Querystring: ShortfallQuery }>(
    '/v1/account/shortfall',
    {
      schema: {
        description:
          'Claimable shortfall for a wallet (public, L0-3): USDC the vault still owes this ' +
          'trader from payouts it could not cover in full, plus the global repayment ' +
          'reserve. supported=false means the deployed vault predates the shortfall ledger ' +
          '(or the read failed) — hide the surface, the zeros are not facts.',
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
              owed: { type: 'string' },
              reserve: { type: 'string' },
              supported: { type: 'boolean' },
            },
            required: ['address', 'owed', 'reserve', 'supported'],
          },
        },
      },
    },
    async (req, reply) => {
      return reply.send(await shortfall.accountShortfall(req.query.address));
    },
  );
}
