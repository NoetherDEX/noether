/**
 * Events tailer.
 *
 * Polls events_raw for new rows since the last seen inserted_at,
 * decodes the JSON payload, and emits typed broadcasts on the WS bus:
 *   - `events`                       (firehose for everyone)
 *   - `trades.<asset>`               (when payload describes a position event)
 *   - `account.events.<owner>`       (every event that names an owner)
 *
 * Keeps WS clients within ~poll interval of the chain. Phase 12 may
 * replace this with a per-process indexer-bus subscription, but the
 * polling design lets API and indexer remain decoupled processes.
 */

import type { Logger } from 'pino';
import type { Client } from '@libsql/client';
import type { AccountEventPayload, EventPayload, TradePayload, WsBus } from './wsBus.js';

const POSITION_TOPICS = new Set(['position_opened', 'position_closed', 'position_liquidated']);

const KIND_FOR_TOPIC: Record<string, TradePayload['kind']> = {
  position_opened: 'open',
  position_closed: 'close',
  position_liquidated: 'liquidation',
};

export interface LiveTailerOptions {
  db: Client;
  bus: WsBus;
  log: Logger;
  intervalMs?: number;
  /** Lookback when the tailer cold-starts (ms). */
  initialLookbackMs?: number;
}

export class LiveTailer {
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private cursorInsertedAt: number;
  private stopped = false;

  constructor(private readonly opts: LiveTailerOptions) {
    this.intervalMs = opts.intervalMs ?? 1_000;
    this.cursorInsertedAt = Date.now() - (opts.initialLookbackMs ?? 0);
  }

  start(): void {
    if (this.timer) return;
    this.opts.log.info({ intervalMs: this.intervalMs }, 'Live tailer starting');
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    let result;
    try {
      result = await this.opts.db.execute({
        sql: `
          SELECT event_id, contract_id, topic, ledger, ledger_close_ts, tx_hash, payload_json, inserted_at
          FROM events_raw
          WHERE inserted_at > ?
          ORDER BY inserted_at ASC
          LIMIT 200
        `,
        args: [this.cursorInsertedAt],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('no such table')) return; // indexer hasn't run yet
      this.opts.log.warn({ err }, 'live tailer query failed');
      return;
    }

    for (const row of result.rows) {
      const insertedAt = Number(row.inserted_at);
      if (insertedAt > this.cursorInsertedAt) this.cursorInsertedAt = insertedAt;

      const topic = String(row.topic);
      const ledger = Number(row.ledger);
      const ledgerCloseTs = Number(row.ledger_close_ts);
      const txHash = String(row.tx_hash);
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(String(row.payload_json));
      } catch {
        continue;
      }
      const trader = typeof raw.trader === 'string' ? (raw.trader as string) : undefined;

      const eventPayload: EventPayload = { topic, ledger, ledgerCloseTs, txHash, trader, raw };
      this.opts.bus.emit('events', eventPayload);

      if (POSITION_TOPICS.has(topic) && trader) {
        const kind = KIND_FOR_TOPIC[topic]!;
        const positionId = typeof raw.positionId === 'number' ? raw.positionId : Number(raw.positionId ?? 0);
        const price = pickStr(raw, 'closePrice') ?? pickStr(raw, 'entryPrice') ?? '0';
        const pnl = pickStr(raw, 'pnl');
        const tradePayload: TradePayload = {
          kind,
          asset: typeof raw.asset === 'string' ? (raw.asset as string) : 'UNKNOWN',
          positionId,
          trader,
          price,
          pnl,
          ledger,
          ts: ledgerCloseTs * 1000,
          txHash,
        };
        const tradesChannel = `trades.${tradePayload.asset}` as const;
        this.opts.bus.emit(tradesChannel, tradePayload);
      }

      if (trader) {
        const accountChannel = `account.events.${trader}` as const;
        const accountPayload: AccountEventPayload = { ...eventPayload, owner: trader };
        this.opts.bus.emit(accountChannel, accountPayload);
      }
    }
  }
}

function pickStr(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  return String(v);
}
