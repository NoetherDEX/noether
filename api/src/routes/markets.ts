import type { FastifyInstance } from 'fastify';
import type { MarketsService } from '../services/markets.js';
import type { StatsService } from '../services/stats.js';
import type { CapacityService } from '../services/capacity.js';

interface AssetParam {
  asset: string;
}

const BINDING_ENUM = ['aggregate', 'side', 'skew', 'liquidity', 'maxPosition'] as const;

/** L1-13 pool-capacity headroom — advisory; omitted when the chain read failed. */
const CAPACITY_SCHEMA = {
  type: 'object',
  description:
    'Largest notional the vault accepts for a new long/short on this market right now, ' +
    'with the exact chain inputs behind it (vault caps + market AssetExposure). ' +
    'Advisory: the contract stays the authority (#82 / #89). Omitted when the read failed.',
  properties: {
    headroomLong: { type: 'string' },
    headroomShort: { type: 'string' },
    bindingLong: { type: 'string', enum: BINDING_ENUM },
    bindingShort: { type: 'string', enum: BINDING_ENUM },
    oiLong: { type: 'string' },
    oiShort: { type: 'string' },
    netSkew: { type: 'string' },
    sideCap: { type: 'string' },
    skewCap: { type: 'string' },
    assetCapBps: { type: 'integer' },
    capAbs: { type: 'string' },
    skewCapBps: { type: 'integer' },
    maxPositionSize: { type: ['string', 'null'] },
  },
  required: [
    'headroomLong', 'headroomShort', 'bindingLong', 'bindingShort',
    'oiLong', 'oiShort', 'netSkew', 'sideCap', 'skewCap',
    'assetCapBps', 'capAbs', 'skewCapBps', 'maxPositionSize',
  ],
} as const;

const POOL_SCHEMA = {
  type: 'object',
  description:
    'Vault-wide capacity (L1-13): AUM, reserved payouts, the aggregate cap and the headroom ' +
    'left for new positions on ANY market. Omitted when the read failed; stale:true when served ' +
    'from the last good snapshot after a failed refresh.',
  properties: {
    aum: { type: 'string' },
    reservedPayout: { type: 'string' },
    usdcBalance: { type: 'string' },
    shortfallReserve: { type: 'string' },
    reserveCapBps: { type: 'integer' },
    reserveCap: { type: 'string' },
    aggregateHeadroom: { type: 'string' },
    aggregateBinding: { type: 'string', enum: ['aggregate', 'liquidity'] },
    asOfLedger: { type: ['integer', 'null'] },
    ts: { type: 'integer' },
    stale: { type: 'boolean' },
  },
  required: [
    'aum', 'reservedPayout', 'usdcBalance', 'shortfallReserve', 'reserveCapBps', 'reserveCap',
    'aggregateHeadroom', 'aggregateBinding', 'asOfLedger', 'ts', 'stale',
  ],
} as const;

const ASSET_STATS_SCHEMA = {
  type: 'object',
  properties: {
    asset: { type: 'string' },
    openInterestLong: { type: 'string' },
    openInterestShort: { type: 'string' },
    openInterestNet: { type: 'string' },
    openPositions: { type: 'integer' },
    volume24h: { type: 'string' },
    capacity: CAPACITY_SCHEMA,
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
  capacity?: CapacityService,
): Promise<void> {
  app.get(
    '/v1/markets/stats',
    {
      schema: {
        description:
          'Per-asset open interest (long / short / net, from the open-positions projection) and ' +
          '24h traded volume (position_opened + realized position_closed / liquidated notional). ' +
          'All amounts are i128 decimal strings with 7-decimal USDC precision. The solvency object ' +
          'carries market-scoped lifetime bad debt (L0-2): how much the insurance buffer absorbed ' +
          'vs how much fell through to LP NAV. Each row may carry a `capacity` block and the response a ' +
          '`pool` block (L1-13 headroom, chain-read; omitted — never zeroed — when the read failed).',
        tags: ['markets'],
        response: {
          200: {
            type: 'object',
            properties: {
              stats: { type: 'array', items: ASSET_STATS_SCHEMA },
              pool: POOL_SCHEMA,
              solvency: {
                type: 'object',
                properties: {
                  cumulativeBadDebtCovered: { type: 'string' },
                  cumulativeBadDebtLpAbsorbed: { type: 'string' },
                  badDebtEvents: { type: 'integer' },
                },
                required: ['cumulativeBadDebtCovered', 'cumulativeBadDebtLpAbsorbed', 'badDebtEvents'],
              },
            },
            required: ['stats', 'solvency'],
          },
        },
      },
    },
    async (_req, reply) => {
      const [assetStats, solvency, snapshot] = await Promise.all([
        stats.marketStats(),
        stats.solvencyStats(),
        capacity ? capacity.snapshot() : Promise.resolve(null),
      ]);
      const rows = assetStats.map((s) => {
        const c = snapshot?.assets[s.asset];
        return c ? { ...s, capacity: c } : s;
      });
      return reply.send(snapshot ? { stats: rows, pool: snapshot.pool, solvency } : { stats: rows, solvency });
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
