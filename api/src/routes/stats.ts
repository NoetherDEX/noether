import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Client } from '@libsql/client';

const DAY_SECONDS = 86_400;

/** SQLite COUNT comes back as number | bigint | null — normalize to a number. */
function asCount(v: unknown): number {
  return v === null || v === undefined ? 0 : Number(v);
}

/** Keep PRECISION-scaled sums as strings (they can exceed Number.MAX_SAFE_INTEGER). */
function asScaled(v: unknown): string {
  return v === null || v === undefined ? '0' : String(v);
}

/**
 * Public, read-only protocol metrics (P4-5 stats, P4-6 volume). Both are sourced
 * from the indexer: opening volume / trade count from `position_opened` events in
 * events_raw (payload `size` is a PRECISION-scaled string), open interest from the
 * `positions` projection. No auth — these are aggregate, non-sensitive numbers.
 */
export async function registerStatsRoutes(app: FastifyInstance, db: Client): Promise<void> {
  app.get(
    '/v1/stats',
    {
      schema: {
        description:
          'Protocol-wide aggregate stats: cumulative and rolling-24h opening volume + ' +
          'trade count, current open interest / open positions, and unique traders. ' +
          'Public, read-only, materialized from indexed market events.',
        tags: ['stats'],
      },
    },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const since = Math.floor(Date.now() / 1000) - DAY_SECONDS;

      const totals = await db.execute({
        sql: `
          SELECT
            COUNT(*) AS trades,
            COALESCE(SUM(CAST(json_extract(payload_json, '$.size') AS INTEGER)), 0) AS volume,
            COUNT(DISTINCT json_extract(payload_json, '$.trader')) AS traders
          FROM events_raw
          WHERE topic = 'position_opened'
        `,
      });
      const day = await db.execute({
        sql: `
          SELECT
            COUNT(*) AS trades,
            COALESCE(SUM(CAST(json_extract(payload_json, '$.size') AS INTEGER)), 0) AS volume
          FROM events_raw
          WHERE topic = 'position_opened' AND ledger_close_ts >= ?
        `,
        args: [since],
      });
      const oi = await db.execute({
        sql: `
          SELECT COUNT(*) AS open_positions,
                 COALESCE(SUM(CAST(size AS INTEGER)), 0) AS open_interest
          FROM positions
        `,
      });

      const t = totals.rows[0] as Record<string, unknown> | undefined;
      const d = day.rows[0] as Record<string, unknown> | undefined;
      const o = oi.rows[0] as Record<string, unknown> | undefined;
      return reply.send({
        totalVolume: asScaled(t?.volume),
        volume24h: asScaled(d?.volume),
        totalTrades: asCount(t?.trades),
        trades24h: asCount(d?.trades),
        openInterest: asScaled(o?.open_interest),
        openPositions: asCount(o?.open_positions),
        uniqueTraders: asCount(t?.traders),
      });
    },
  );

  app.get(
    '/v1/volume',
    {
      schema: {
        description:
          'Rolling-24h opening volume, overall and broken down per asset. Public, ' +
          'read-only, materialized from indexed market events.',
        tags: ['stats'],
      },
    },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const since = Math.floor(Date.now() / 1000) - DAY_SECONDS;
      const result = await db.execute({
        sql: `
          SELECT
            json_extract(payload_json, '$.asset') AS asset,
            COALESCE(SUM(CAST(json_extract(payload_json, '$.size') AS INTEGER)), 0) AS volume,
            COUNT(*) AS trades
          FROM events_raw
          WHERE topic = 'position_opened' AND ledger_close_ts >= ?
          GROUP BY asset
          ORDER BY volume DESC
        `,
        args: [since],
      });
      const byAsset = result.rows
        .filter((r) => r.asset !== null)
        .map((r) => ({
          asset: String(r.asset),
          volume: asScaled(r.volume),
          trades: asCount(r.trades),
        }));
      const totalVolume = byAsset.reduce((acc, a) => acc + BigInt(a.volume), 0n).toString();
      return reply.send({ window: '24h', totalVolume, byAsset });
    },
  );
}
