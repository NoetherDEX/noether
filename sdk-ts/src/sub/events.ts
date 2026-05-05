import type { Transport } from '../transport.js';

export interface RawEvent {
  eventId: string;
  contractId: string;
  topic: string;
  ledger: number;
  ledgerCloseTs: number;
  txHash: string;
  payload: unknown;
  insertedAt: number;
}

export interface EventQuery {
  topic?: string;
  contract?: string;
  fromLedger?: number;
  toLedger?: number;
  limit?: number;
}

export class EventsApi {
  constructor(private readonly transport: Transport) {}

  async list(query: EventQuery = {}): Promise<RawEvent[]> {
    const res = await this.transport.request<{ events: RawEvent[] }>({
      path: '/v1/events',
      query: {
        topic: query.topic,
        contract: query.contract,
        from_ledger: query.fromLedger,
        to_ledger: query.toLedger,
        limit: query.limit,
      },
    });
    return res.events;
  }
}
