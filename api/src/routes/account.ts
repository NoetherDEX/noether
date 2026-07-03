import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EventsService } from '../services/events.js';
import type { Client } from '@libsql/client';

interface EventQueryString {
  topic?: string;
  limit?: number;
}

const POSITION_TOPICS = ['position_opened', 'position_closed', 'position_liquidated'];
const ORDER_TOPICS = ['order_placed', 'order_executed', 'order_cancelled'];

export async function registerAccountRoutes(
  app: FastifyInstance,
  events: EventsService,
  db: Client,
): Promise<void> {
  app.get(
    '/v1/account/me',
    {
      preHandler: app.requireAuth,
      schema: {
        description: 'Identity and tier of the authenticated API key holder.',
        tags: ['account'],
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return reply.send({
        owner: user.owner,
        tier: user.tier,
        keyId: user.keyId,
      });
    },
  );

  app.get<{ Querystring: EventQueryString }>(
    '/v1/account/me/events',
    {
      preHandler: app.requireAuth,
      schema: {
        description: 'Decoded contract events whose payload references the authenticated owner address.',
        tags: ['account'],
        querystring: {
          type: 'object',
          properties: {
            topic: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 500 },
          },
        },
      },
    },
    async (req, reply) => {
      const owner = req.user!.owner;
      const limit = Math.min(500, Math.max(1, req.query.limit ?? 50));
      const topicFilter = req.query.topic ? [req.query.topic] : null;

      try {
        const conditions: string[] = [`json_extract(payload_json, '$.trader') = ?`];
        const args: (string | number)[] = [owner];
        if (topicFilter) {
          conditions.push(`topic = ?`);
          args.push(topicFilter[0]!);
        }
        const result = await db.execute({
          sql: `
            SELECT event_id, contract_id, topic, ledger, ledger_close_ts, tx_hash, payload_json, inserted_at
            FROM events_raw
            WHERE ${conditions.join(' AND ')}
            ORDER BY ledger DESC, event_id DESC
            LIMIT ?
          `,
          args: [...args, limit],
        });
        return reply.send({
          events: result.rows.map((row) => ({
            eventId: String(row.event_id),
            contractId: String(row.contract_id),
            topic: String(row.topic),
            ledger: Number(row.ledger),
            ledgerCloseTs: Number(row.ledger_close_ts),
            txHash: String(row.tx_hash),
            payload: JSON.parse(String(row.payload_json)),
            insertedAt: Number(row.inserted_at),
          })),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('no such table')) {
          return reply.send({ events: [] });
        }
        throw err;
      }
    },
  );

  app.get(
    '/v1/account/me/positions',
    {
      preHandler: app.requireAuth,
      schema: {
        description:
          'Position-related events for the authenticated owner (position_opened, position_closed, position_liquidated).',
        tags: ['account'],
      },
    },
    async (req, reply) => {
      const owner = req.user!.owner;
      const filtered = await events.listByTrader(owner, POSITION_TOPICS, 500);
      return reply.send({ events: filtered });
    },
  );

  app.get(
    '/v1/account/me/orders',
    {
      preHandler: app.requireAuth,
      schema: {
        description: 'Order-related events for the authenticated owner.',
        tags: ['account'],
      },
    },
    async (req, reply) => {
      const owner = req.user!.owner;
      const filtered = await events.listByTrader(owner, ORDER_TOPICS, 500);
      return reply.send({ events: filtered });
    },
  );
}
