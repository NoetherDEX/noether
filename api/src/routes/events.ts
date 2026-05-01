import type { FastifyInstance } from 'fastify';
import type { EventsService } from '../services/events.js';

interface EventQueryString {
  topic?: string;
  contract?: string;
  from_ledger?: number;
  to_ledger?: number;
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
            limit: { type: 'integer', minimum: 1, maximum: 500 },
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
        limit: req.query.limit,
      });
      return reply.send({ events: rows });
    },
  );
}
