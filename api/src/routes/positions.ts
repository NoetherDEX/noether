import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Client } from '@libsql/client';

interface OpenPositionsQuery {
  trader?: string;
}

interface PositionRow {
  position_id: number | bigint;
  trader: string;
  asset: string;
  direction: number;
  size: string;
  entry_price: string;
  opened_at: number;
  opened_tx_hash: string;
}

export async function registerPositionsRoutes(
  app: FastifyInstance,
  db: Client,
): Promise<void> {
  app.get<{ Querystring: OpenPositionsQuery }>(
    '/v1/positions/open',
    {
      schema: {
        description:
          'Currently open positions on the market, optionally filtered by trader. ' +
          'Materialized from position_opened minus position_closed/liquidated events. ' +
          'Use this to avoid iterating every on-chain position id (slow for clients ' +
          'who only care about one trader, like the /trade leader-mode panel).',
        tags: ['positions'],
      },
    },
    async (req: FastifyRequest<{ Querystring: OpenPositionsQuery }>, reply: FastifyReply) => {
      const trader = req.query.trader?.trim();
      const sql = trader
        ? 'SELECT * FROM positions WHERE trader = ? ORDER BY opened_at DESC'
        : 'SELECT * FROM positions ORDER BY opened_at DESC LIMIT 200';
      const result = await db.execute(trader ? { sql, args: [trader] } : { sql });
      const rows = (result.rows as unknown as PositionRow[]).map((r) => ({
        positionId: Number(r.position_id),
        trader: r.trader,
        asset: r.asset,
        direction: Number(r.direction),
        size: String(r.size),
        entryPrice: String(r.entry_price),
        openedAt: Number(r.opened_at),
        openedTxHash: r.opened_tx_hash,
      }));
      return reply.send({ positions: rows });
    },
  );
}
