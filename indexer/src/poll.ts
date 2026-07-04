/**
 * Main polling loop.
 *
 * Pulls Soroban contract events from the configured RPC, decodes them,
 * and dispatches through the router. Cursor is persisted after each
 * successful batch so restarts resume cleanly.
 */

import type { Logger } from 'pino';
import type { Client } from '@libsql/client';
import type { rpc as RpcNs, xdr } from '@stellar/stellar-sdk';
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

  private async pollOnce(): Promise<number> {
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
        await this.deadLetter(raw.id, contractId, raw.ledger, 'decode', err, rawEventPayload(raw as unknown as RawEvent));
        highestLedger = Math.max(highestLedger, raw.ledger);
        continue;
      }
      if (!decoded) {
        this.deps.log.debug({ id: raw.id, topics: raw.topic.length }, 'Unrecognised event topic — skipped');
        continue;
      }
      try {
        await this.deps.router.dispatch(decoded as any, ctx);
      } catch (err) {
        await this.deadLetter(raw.id, contractId, raw.ledger, 'apply', err, decoded);
        throw err;
      }
      processed++;
      highestLedger = Math.max(highestLedger, decoded.ledger);
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

function rawEventPayload(raw: RawEvent): unknown {
  try {
    return {
      txHash: raw.txHash,
      topicXdr: (raw.topic as xdr.ScVal[]).map((t) => t.toXDR('base64')),
      valueXdr: (raw.value as unknown as xdr.ScVal).toXDR('base64'),
    };
  } catch {
    return { txHash: raw.txHash };
  }
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
