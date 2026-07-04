import type { FastifyInstance } from 'fastify';
import type { EventsService } from '../services/events.js';

interface EventQueryString {
  topic?: string;
  contract?: string;
  from_ledger?: number;
  to_ledger?: number;
  before_ts?: number;
  limit?: number;
}

export async function registerEventsRoutes(
  app: FastifyInstance,
  events: EventsService,
): Promise<void> {
  app.get<{ Querystring: EventQueryString }>(
    '/v1/events',
    {
      schema: {
        description:
          'Raw decoded contract events captured by the indexer. Phase 3 surfaces this directly; trade and candle projections land in Phase 3.1.',
        tags: ['events'],
        querystring: {
          type: 'object',
          properties: {
            topic: { type: 'string' },
            contract: { type: 'string' },
            from_ledger: { type: 'integer', minimum: 0 },
            to_ledger: { type: 'integer', minimum: 0 },
            before_ts: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 500 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              events: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    eventId: { type: 'string' },
                    contractId: { type: 'string' },
                    topic: { type: 'string' },
                    ledger: { type: 'integer' },
                    ledgerCloseTs: { type: 'integer' },
                    txHash: { type: 'string' },
                    payload: {},
                    insertedAt: { type: 'integer' },
                  },
                  required: ['eventId', 'contractId', 'topic', 'ledger', 'ledgerCloseTs', 'txHash'],
                },
              },
            },
            required: ['events'],
          },
        },
      },
    },
    async (req, reply) => {
      const rows = await events.list({
        topic: req.query.topic,
        contractId: req.query.contract,
        fromLedger: req.query.from_ledger,
        toLedger: req.query.to_ledger,
        beforeTs: req.query.before_ts,
        limit: req.query.limit,
      });
      return reply.send({ events: rows });
    },
  );
}
