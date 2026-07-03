/**
 * Main polling loop.
 *
 * Pulls Soroban contract events from the configured RPC, decodes them,
 * and dispatches through the router. Cursor is persisted after each
 * successful batch so restarts resume cleanly.
 */

import type { Logger } from 'pino';
import type { Client } from '@libsql/client';
import type { rpc as RpcNs } from '@stellar/stellar-sdk';
import type { IndexerBus } from './bus.js';
import type { EventRouter, HandlerContext } from './router.js';
import { decodeMarketEvent, type RawEvent } from './decoders/market.js';
import { decodeVaultEvent } from './decoders/vault.js';
import { decodeReferralEvent } from './decoders/referral.js';
import { fetchEvents, getLatestLedger } from './rpc.js';
import { readCursor, writeCursor } from './cursor.js';

export interface PollDeps {
  db: Client;
  rpc: RpcNs.Server;
  bus: IndexerBus;
  router: EventRouter;
  log: Logger;
  contractIds: string[];
  /** Per-contract decoder dispatch. Falls back to the market decoder. */
  marketContract: string;
  vaultFactoryContract?: string;
  referralContract?: string;
  pollIntervalMs: number;
  coldStartLedgers: number;
}

export class IndexerPoller {
  private running = false;
  private stopped = false;

  constructor(private readonly deps: PollDeps) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.deps.log.info({ contractIds: this.deps.contractIds }, 'Poller starting');
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        const inserted = await this.pollOnce();
        if (inserted > 0) {
          this.deps.log.info({ inserted }, 'Batch processed');
        } else {
          this.deps.log.debug('No new events');
        }
      } catch (err) {
        this.deps.log.error({ err }, 'Poll iteration failed');
      }
      await sleep(this.deps.pollIntervalMs, () => this.stopped);
    }
    this.deps.log.info('Poller stopped');
  }

  /** Public for tests; the loop above is the only production caller. */
  async pollOnce(): Promise<number> {
    const cursor = await readCursor(this.deps.db);
    const startLedger = cursor?.lastLedger ?? (await this.coldStartLedger());

    const response = await fetchEvents(this.deps.rpc, {
      startLedger,
      contractIds: this.deps.contractIds,
      cursor: cursor?.lastPagingToken ?? undefined,
    });

    const ctx: HandlerContext = {
      db: this.deps.db,
      rpc: this.deps.rpc,
      bus: this.deps.bus,
      log: this.deps.log,
    };

    let processed = 0;
    let highestLedger = cursor?.lastLedger ?? 0;

    for (const raw of response.events) {
      const contractId = raw.contractId?.toString() ?? '';
      try {
        let decoded: ReturnType<typeof decodeMarketEvent> | null = null;
        if (contractId === this.deps.vaultFactoryContract) {
          decoded = decodeVaultEvent(raw as unknown as RawEvent) as any;
        } else if (contractId === this.deps.referralContract) {
          decoded = decodeReferralEvent(raw as unknown as RawEvent) as any;
        } else {
          decoded = decodeMarketEvent(raw as unknown as RawEvent);
        }
        if (!decoded) {
          this.deps.log.debug({ id: raw.id, topics: raw.topic.length }, 'Unrecognised event topic — skipped');
          continue;
        }
        await this.deps.router.dispatch(decoded as any, ctx);
        processed++;
        highestLedger = Math.max(highestLedger, decoded.ledger);
      } catch (err) {
        // Per-event isolation (I-1): a single malformed payload or failing
        // handler must not wedge the cursor. Record it to dead_letter and keep
        // going so the batch — and the cursor — still advances. The event is
        // preserved for inspection/replay, never silently dropped.
        await this.deadLetter(raw as unknown as RawEvent, err);
        highestLedger = Math.max(highestLedger, (raw as { ledger?: number }).ledger ?? 0);
      }
    }

    if (response.events.length > 0 || cursor === null) {
      await writeCursor(this.deps.db, {
        lastLedger: highestLedger || startLedger,
        lastPagingToken: response.cursor ?? cursor?.lastPagingToken ?? null,
        updatedAt: Date.now(),
      });
    }

    return processed;
  }

  private async coldStartLedger(): Promise<number> {
    const latest = await getLatestLedger(this.deps.rpc);
    return Math.max(1, latest - this.deps.coldStartLedgers);
  }

  /**
   * Record an event that failed to decode or dispatch. Best-effort: if even the
   * dead_letter write fails we log loudly but do NOT rethrow — rethrowing would
   * re-wedge the poller, the exact failure mode this guard exists to prevent.
   */
  private async deadLetter(raw: RawEvent, err: unknown): Promise<void> {
    const eventId = raw.id ?? `unknown-${(raw as { ledger?: number }).ledger ?? 0}`;
    const errorMsg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    this.deps.log.error({ err, eventId }, 'Event decode/handler failed — dead-lettered');
    try {
      await this.deps.db.execute({
        sql: `
          INSERT INTO dead_letter (event_id, contract_id, ledger, error, raw_xdr, inserted_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(event_id) DO UPDATE SET
            error = excluded.error,
            inserted_at = excluded.inserted_at
        `,
        args: [
          eventId,
          raw.contractId?.toString() ?? null,
          (raw as { ledger?: number }).ledger ?? null,
          errorMsg.slice(0, 4000),
          rawEventXdr(raw),
          Date.now(),
        ],
      });
    } catch (dlErr) {
      this.deps.log.error({ dlErr, eventId }, 'Failed to persist dead_letter row');
    }
  }
}

/** Best-effort base64-XDR capture of a raw event for the dead-letter row. */
function rawEventXdr(raw: RawEvent): string | null {
  try {
    const value = (raw as { value?: { toXDR?: (f: string) => string } }).value;
    const valueXdr = typeof value?.toXDR === 'function' ? value.toXDR('base64') : null;
    const topicArr = (raw as { topic?: Array<{ toXDR?: (f: string) => string }> }).topic;
    const topic = Array.isArray(topicArr)
      ? topicArr.map((t) => (typeof t?.toXDR === 'function' ? t.toXDR('base64') : null))
      : [];
    return JSON.stringify({ value: valueXdr, topic });
  } catch {
    return null;
  }
}

async function sleep(ms: number, isStopped: () => boolean): Promise<void> {
  // Granular sleep so SIGINT shuts down faster than full pollIntervalMs.
  const step = 250;
  const iterations = Math.max(1, Math.floor(ms / step));
  for (let i = 0; i < iterations; i++) {
    if (isStopped()) return;
    await new Promise((r) => setTimeout(r, step));
  }
}
