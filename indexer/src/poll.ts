/**
 * Main polling loop.
 *
 * Pulls Soroban contract events from the configured RPC pool, decodes
 * them, and dispatches through the router. Cursor is persisted after
 * each successful batch via a compare-and-swap write so two pollers
 * can never double-apply (I-4). When the RPC retention window moves
 * past the cursor, the skipped range is recorded in ledger_gaps and
 * the cursor clamps to the oldest retained ledger instead of wedging
 * or silently resuming (I-3).
 */

import type { Logger } from 'pino';
import type { Db } from '@noether/db';
import type { rpc as RpcNs, xdr } from '@stellar/stellar-sdk';
import type { IndexerBus } from './bus.js';
import type { EventRouter, HandlerContext } from './router.js';
import { decodeMarketEvent, type RawEvent } from './decoders/market.js';
import { decodeVaultEvent } from './decoders/vault.js';
import { decodeReferralEvent } from './decoders/referral.js';
import { fetchEvents, getLatestLedger, getOldestLedger, parseRetentionError, type RpcPool } from './rpc.js';
import { readCursor, writeCursor, type PollCursor } from './cursor.js';

export interface PollDeps {
  db: Db;
  rpcPool: RpcPool;
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
  /** Warn when the cursor is within this many ledgers of the retention edge. */
  retentionWarnLedgers?: number;
  retentionCheckEveryMs?: number;
}

export interface PollerHealth {
  running: boolean;
  fatal: string | null;
  startedAt: number | null;
  lastPollOkAt: number | null;
  lastLedger: number | null;
  lastEventCloseTs: number | null;
}

const DEFAULT_RETENTION_WARN_LEDGERS = 10_000;
const DEFAULT_RETENTION_CHECK_EVERY_MS = 600_000;
/** Max staleness of poll_cursor.updated_at before a quiet poll rewrites it. */
const HEARTBEAT_EVERY_MS = 30_000;

export class IndexerPoller {
  private running = false;
  private stopped = false;
  private fatal: string | null = null;
  private startedAt: number | null = null;
  private lastPollOkAt: number | null = null;
  private lastLedger: number | null = null;
  private lastEventCloseTs: number | null = null;
  private lastRetentionCheckAt = Date.now();

  constructor(private readonly deps: PollDeps) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.startedAt = Date.now();
    this.deps.log.info({ contractIds: this.deps.contractIds }, 'Poller starting');
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
  }

  health(): PollerHealth {
    return {
      running: this.running && !this.stopped,
      fatal: this.fatal,
      startedAt: this.startedAt,
      lastPollOkAt: this.lastPollOkAt,
      lastLedger: this.lastLedger,
      lastEventCloseTs: this.lastEventCloseTs,
    };
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        const inserted = await this.pollOnce();
        this.lastPollOkAt = Date.now();
        if (inserted > 0) {
          this.deps.log.info({ inserted }, 'Batch processed');
        } else {
          this.deps.log.debug('No new events');
        }
      } catch (err) {
        this.deps.log.error({ err, rpcUrl: this.deps.rpcPool.currentUrl() }, 'Poll iteration failed');
      }
      await sleep(this.deps.pollIntervalMs, () => this.stopped);
    }
    this.deps.log.info('Poller stopped');
  }

  private async pollOnce(): Promise<number> {
    const cursor = await readCursor(this.deps.db);
    const startLedger = cursor?.lastLedger ?? (await this.coldStartLedger());

    let response: RpcNs.Api.GetEventsResponse;
    try {
      response = await fetchEvents(this.deps.rpcPool, {
        startLedger,
        contractIds: this.deps.contractIds,
        cursor: cursor?.lastPagingToken ?? undefined,
      });
    } catch (err) {
      const retention = parseRetentionError(err);
      if (!retention) throw err;
      await this.clampToRetention(cursor, startLedger, retention.oldestLedger);
      return 0;
    }

    await this.maybeWarnRetentionEdge(cursor?.lastLedger ?? startLedger);

    const ctx: HandlerContext = {
      db: this.deps.db,
      rpc: this.deps.rpcPool.current(),
      bus: this.deps.bus,
      log: this.deps.log,
    };

    let processed = 0;
    let highestLedger = cursor?.lastLedger ?? 0;
    let highestCloseTs: number | null = null;

    for (const raw of response.events) {
      const contractId = raw.contractId?.toString() ?? '';
      // Capture the raw XDR BEFORE decoding so a decoder bug is always
      // recoverable from the archive (events_raw or dead_letter) (I-6).
      const rawXdr = extractRawXdr(raw as unknown as RawEvent);
      let decoded: ReturnType<typeof decodeMarketEvent> | null = null;
      try {
        if (contractId === this.deps.vaultFactoryContract) {
          decoded = decodeVaultEvent(raw as unknown as RawEvent) as any;
        } else if (contractId === this.deps.referralContract) {
          decoded = decodeReferralEvent(raw as unknown as RawEvent) as any;
        } else {
          decoded = decodeMarketEvent(raw as unknown as RawEvent);
        }
      } catch (err) {
        this.deps.log.error({ err, id: raw.id }, 'Event decode failed — dead-lettered');
        await this.deadLetter(raw.id, contractId, raw.ledger, 'decode', err, rawXdrPayload(raw.txHash, rawXdr));
        highestLedger = Math.max(highestLedger, raw.ledger);
        continue;
      }
      if (!decoded) {
        this.deps.log.debug({ id: raw.id, topics: raw.topic.length }, 'Unrecognised event topic — skipped');
        continue;
      }
      if (rawXdr) {
        const target = decoded as { topicXdr?: string[]; valueXdr?: string };
        target.topicXdr = rawXdr.topicXdr;
        target.valueXdr = rawXdr.valueXdr;
      }
      try {
        await this.deps.router.dispatch(decoded as any, ctx);
      } catch (err) {
        await this.deadLetter(raw.id, contractId, raw.ledger, 'apply', err, decoded);
        throw err;
      }
      processed++;
      highestLedger = Math.max(highestLedger, decoded.ledger);
      highestCloseTs = Math.max(highestCloseTs ?? 0, decoded.ledgerCloseTs);
    }

    if (response.events.length > 0 || cursor === null) {
      const next: PollCursor = {
        lastLedger: highestLedger || startLedger,
        lastPagingToken: response.cursor ?? cursor?.lastPagingToken ?? null,
        updatedAt: Date.now(),
      };
      if (!(await this.commitCursor(next, cursor?.lastLedger ?? null))) return processed;
    } else if (Date.now() - cursor.updatedAt >= HEARTBEAT_EVERY_MS) {
      // Heartbeat on quiet polls: refresh updated_at ONLY. Without it the
      // cursor row is written only when a batch carries events, so
      // updated_at freezes between on-chain trades and health's
      // ledgerAgeSeconds — the "indexer is alive" signal for monitoring
      // (P3-1/D-2) AND the web's gatewayServesThisMarket() trust gate —
      // reads as a stall on any quiet market. lastLedger and the pagination
      // token are deliberately NOT touched: the stored token (present after
      // every real batch — getEvents always returns a resume cursor) is the
      // precise resume position, and advancing lastLedger past it would skip
      // events should the token ever become unusable (e.g. across an RPC
      // pool rotation). Throttled so a quiet market costs one row write per
      // HEARTBEAT_EVERY_MS, not one per 2s poll.
      const next: PollCursor = {
        lastLedger: cursor.lastLedger,
        lastPagingToken: cursor.lastPagingToken,
        updatedAt: Date.now(),
      };
      if (!(await this.commitCursor(next, cursor.lastLedger))) return processed;
    }
    if (highestCloseTs !== null) this.lastEventCloseTs = highestCloseTs;

    return processed;
  }

  /**
   * CAS cursor write. A miss means another poller owns this database
   * (Railway deploy overlap, mis-pointed env) — stop instead of
   * double-applying relative projection updates.
   */
  private async commitCursor(next: PollCursor, expected: number | null): Promise<boolean> {
    const ok = await writeCursor(this.deps.db, next, expected);
    if (!ok) {
      this.fatal = 'cursor_cas_miss';
      this.deps.log.fatal(
        { expected, attempted: next.lastLedger },
        'Cursor CAS miss — another poller is writing this database; stopping to avoid double-apply',
      );
      this.stop();
      return false;
    }
    this.lastLedger = next.lastLedger;
    return true;
  }

  private async clampToRetention(
    cursor: PollCursor | null,
    startLedger: number,
    parsedOldest: number | null,
  ): Promise<void> {
    const oldest = parsedOldest ?? (await getOldestLedger(this.deps.rpcPool.current()));
    if (oldest === null) {
      this.deps.log.error(
        { startLedger },
        'Cursor is outside the RPC retention window and the oldest retained ledger could not be resolved — will retry',
      );
      return;
    }
    const from = cursor?.lastLedger ?? startLedger;
    const to = oldest - 1;
    if (to >= from) {
      await this.deps.db.execute({
        sql: 'INSERT INTO ledger_gaps (from_ledger, to_ledger, reason, recorded_at) VALUES (?, ?, ?, ?)',
        args: [from, to, 'rpc_retention', Date.now()],
      });
    }
    this.deps.log.error(
      { from, to, resumeAt: oldest },
      'RPC retention window moved past the cursor — recorded ledger gap and clamped; events in the gap are lost unless backfilled',
    );
    await this.commitCursor(
      { lastLedger: oldest, lastPagingToken: null, updatedAt: Date.now() },
      cursor?.lastLedger ?? null,
    );
  }

  private async maybeWarnRetentionEdge(cursorLedger: number): Promise<void> {
    const every = this.deps.retentionCheckEveryMs ?? DEFAULT_RETENTION_CHECK_EVERY_MS;
    if (Date.now() - this.lastRetentionCheckAt < every) return;
    this.lastRetentionCheckAt = Date.now();
    const oldest = await getOldestLedger(this.deps.rpcPool.current());
    if (oldest === null) return;
    const margin = this.deps.retentionWarnLedgers ?? DEFAULT_RETENTION_WARN_LEDGERS;
    if (cursorLedger - oldest < margin) {
      this.deps.log.warn(
        { cursorLedger, oldestLedger: oldest, margin },
        'Cursor is close to the RPC retention edge — prolonged downtime will lose events',
      );
    }
  }

  private async coldStartLedger(): Promise<number> {
    const latest = await getLatestLedger(this.deps.rpcPool.current());
    return Math.max(1, latest - this.deps.coldStartLedgers);
  }

  private async deadLetter(
    eventId: string,
    contractId: string,
    ledger: number,
    stage: 'decode' | 'apply',
    err: unknown,
    payload: unknown,
  ): Promise<void> {
    await this.deps.db.execute({
      sql: `
        INSERT INTO dead_letter (event_id, contract_id, ledger, stage, error, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        eventId,
        contractId,
        ledger,
        stage,
        err instanceof Error ? err.message : String(err),
        safeStringify(payload),
        Date.now(),
      ],
    });
  }
}

function extractRawXdr(raw: RawEvent): { topicXdr: string[]; valueXdr: string } | null {
  try {
    return {
      topicXdr: (raw.topic as xdr.ScVal[]).map((t) => t.toXDR('base64')),
      valueXdr: (raw.value as unknown as xdr.ScVal).toXDR('base64'),
    };
  } catch {
    return null;
  }
}

function rawXdrPayload(txHash: string, rawXdr: { topicXdr: string[]; valueXdr: string } | null): unknown {
  return rawXdr ? { txHash, ...rawXdr } : { txHash };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) ?? String(value);
  } catch {
    return String(value);
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
