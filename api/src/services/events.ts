import type { Client } from '@libsql/client';

export interface RawEventRow {
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
  contractId?: string;
  fromLedger?: number;
  toLedger?: number;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export class EventsService {
  constructor(private readonly db: Client) {}

  async list(query: EventQuery = {}): Promise<RawEventRow[]> {
    const conditions: string[] = [];
    const args: (string | number)[] = [];

    if (query.topic) {
      conditions.push('topic = ?');
      args.push(query.topic);
    }
    if (query.contractId) {
      conditions.push('contract_id = ?');
      args.push(query.contractId);
    }
    if (query.fromLedger !== undefined) {
      conditions.push('ledger >= ?');
      args.push(query.fromLedger);
    }
    if (query.toLedger !== undefined) {
      conditions.push('ledger <= ?');
      args.push(query.toLedger);
    }

    return this.query(conditions, args, query.limit);
  }

  /**
   * Events whose payload `trader` field equals `trader`, optionally restricted
   * to a set of topics. The filter runs in SQL, so a trader's events are found
   * no matter how many unrelated global events sit ahead of theirs — fixing the
   * prior "fetch recent N, filter in JS" window that hid active traders.
   */
  async listByTrader(
    trader: string,
    topics: string[] = [],
    limit?: number,
  ): Promise<RawEventRow[]> {
    const conditions: string[] = [`json_extract(payload_json, '$.trader') = ?`];
    const args: (string | number)[] = [trader];
    if (topics.length > 0) {
      conditions.push(`topic IN (${topics.map(() => '?').join(', ')})`);
      args.push(...topics);
    }
    return this.query(conditions, args, limit);
  }

  private async query(
    conditions: string[],
    args: (string | number)[],
    limit?: number,
  ): Promise<RawEventRow[]> {
    const cappedLimit = Math.min(MAX_LIMIT, Math.max(1, limit ?? DEFAULT_LIMIT));
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    let result;
    try {
      result = await this.db.execute({
        sql: `
          SELECT event_id, contract_id, topic, ledger, ledger_close_ts, tx_hash, payload_json, inserted_at
          FROM events_raw
          ${where}
          ORDER BY ledger DESC, event_id DESC
          LIMIT ?
        `,
        args: [...args, cappedLimit],
      });
    } catch (err) {
      // events_raw is owned by the indexer. If the indexer hasn't run yet
      // against this DB the table won't exist — return empty rather than
      // 500ing, so the API stays usable before the indexer's first poll.
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('no such table')) {
        return [];
      }
      throw err;
    }

    return result.rows.map((row) => ({
      eventId: String(row.event_id),
      contractId: String(row.contract_id),
      topic: String(row.topic),
      ledger: Number(row.ledger),
      ledgerCloseTs: Number(row.ledger_close_ts),
      txHash: String(row.tx_hash),
      payload: JSON.parse(String(row.payload_json)),
      insertedAt: Number(row.inserted_at),
    }));
  }
}
