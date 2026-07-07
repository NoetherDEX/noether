import type { FastifyInstance } from 'fastify';
import type { StatsService } from '../services/stats.js';
import { fetchBinanceCandles } from '../services/binanceCandles.js';

interface CandlesQuery {
  asset?: string;
  interval?: string;
  limit?: number;
}

const ALLOWED_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

const CANDLE_SCHEMA = {
  type: 'object',
  properties: {
    time: { type: 'integer' },
    open: { type: 'number' },
    high: { type: 'number' },
    low: { type: 'number' },
    close: { type: 'number' },
  },
  required: ['time', 'open', 'high', 'low', 'close'],
} as const;

export async function registerCandlesRoutes(
  app: FastifyInstance,
  stats: StatsService,
): Promise<void> {
  app.get<{ Querystring: CandlesQuery }>(
    '/v1/candles',
    {
      schema: {
        description:
          'OHLC candles for an asset, oldest-first. Native Noeracle candles built by ' +
          'the indexer aggregator; transparently falls back to Binance reference candles ' +
          'when the venue has none yet for that asset/interval (see the "source" field).',
        tags: ['markets'],
        querystring: {
          type: 'object',
          required: ['asset'],
          properties: {
            asset: { type: 'string', minLength: 1, maxLength: 12 },
            interval: { type: 'string', enum: ALLOWED_INTERVALS },
            limit: { type: 'integer', minimum: 1, maximum: 1000 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              candles: { type: 'array', items: CANDLE_SCHEMA },
              source: { type: 'string', enum: ['noeracle', 'binance'] },
            },
            required: ['candles', 'source'],
          },
        },
      },
    },
    async (req, reply) => {
      const asset = (req.query.asset ?? '').toUpperCase();
      const interval = req.query.interval ?? '1h';
      const limit = req.query.limit ?? 500;

      let candles = await stats.candles({ asset, interval, limit });
      let source: 'noeracle' | 'binance' = 'noeracle';
      if (candles.length === 0) {
        candles = await fetchBinanceCandles(asset, interval, limit);
        source = 'binance';
      }
      return reply.send({ candles, source });
    },
  );
}
