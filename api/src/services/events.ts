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
  /** Cursor: only rows strictly older than this ledger_close_ts (unix sec). */
  beforeTs?: number;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export class EventsService {
  constructor(private readonly db: Client) {}

  async list(query: EventQuery = {}): Promise<RawEventRow[]> {
    const limit = Math.min(MAX_LIMIT, Math.max(1, query.limit ?? DEFAULT_LIMIT));
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
    if (query.beforeTs !== undefined) {
      conditions.push('ledger_close_ts < ?');
      args.push(query.beforeTs);
    }

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
        args: [...args, limit],
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
