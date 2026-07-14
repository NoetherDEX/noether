import { describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createPgliteDb } from '@noether/db/pglite';
import type { Db } from '@noether/db';
import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import type { Logger } from 'pino';
import { IndexerBus } from '../src/bus.js';
import { EventRouter } from '../src/router.js';
import { buildMarketRegistrations } from '../src/handlers/market.js';
import { runMigrations } from '../src/migrations.js';
import { IndexerPoller, type PollerHealth } from '../src/poll.js';
import { RpcPool } from '../src/rpc.js';
import { writeCursor } from '../src/cursor.js';
import type { RawEvent } from '../src/decoders/market.js';

const FAKE_CONTRACT = 'CCVDWH4ZL4RNVD52CWQ2LABTLUFFF4VLTXIT5LR7AQSLIB7YOZCOFMOD';
const FAKE_TRADER = 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN';
const FAKE_TX_HASH = 'a'.repeat(64);

const noopLogger: Logger = {
  level: 'silent',
  fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(),
  silent: vi.fn(), child: () => noopLogger as Logger,
} as unknown as Logger;

async function setupDb() {
  // In-memory Postgres (PGlite) behind the production Db surface. Running
  // the real migration runner here makes 001_baseline.sql the schema under
  // test.
  const db = createPgliteDb(new PGlite());
  await runMigrations(db);
  return db;
}

function makeRawEvent(id: string, topic: string, value: xdr.ScVal, ledger = 100): RawEvent {
  return {
    id,
    contractId: FAKE_CONTRACT,
    type: 'contract',
    topic: [nativeToScVal(topic, { type: 'symbol' })],
    value,
    ledger,
    ledgerClosedAt: '2026-04-29T00:00:00Z',
    txHash: FAKE_TX_HASH,
    transactionIndex: 0,
    operationIndex: 0,
    inSuccessfulContractCall: true,
  } as unknown as RawEvent;
}

function vec(...vals: xdr.ScVal[]): xdr.ScVal {
  return xdr.ScVal.scvVec(vals);
}

function openedValue(positionId: bigint): xdr.ScVal {
  return vec(
    nativeToScVal(positionId, { type: 'u64' }),
    Address.fromString(FAKE_TRADER).toScVal(),
    nativeToScVal('BTC', { type: 'symbol' }),
    // u32 must be a plain number or the XDR writer refuses to serialize
    nativeToScVal(0, { type: 'u32' }),
    nativeToScVal(1_500_0000000n, { type: 'i128' }),
    nativeToScVal(60_000_0000000n, { type: 'i128' }),
  );
}

interface PollerHandle {
  pollOnce(): Promise<number>;
  health(): PollerHealth;
}

function makePoller(db: Db, router: EventRouter, events: RawEvent[]) {
  const rpc = {
    getEvents: vi.fn(async () => ({ events, cursor: 'tok-1', latestLedger: 200 })),
    getLatestLedger: vi.fn(async () => ({ sequence: 150 })),
  };
  const poller = new IndexerPoller({
    db,
    rpcPool: new RpcPool([rpc as never], ['fake://rpc']),
    bus: new IndexerBus(),
    router,
    log: noopLogger,
    contractIds: [FAKE_CONTRACT],
    marketContract: FAKE_CONTRACT,
    pollIntervalMs: 10,
    coldStartLedgers: 100,
  });
  return poller as unknown as PollerHandle;
}

describe('poller dead-letter handling', () => {
  it('dead-letters malformed events, keeps processing the batch, and advances the cursor', async () => {
    const db = await setupDb();
    const router = new EventRouter();
    for (const reg of buildMarketRegistrations(FAKE_CONTRACT)) {
      router.register(reg.contractId, reg.topic, reg.handler);
    }

    const events = [
      makeRawEvent('evt-1', 'position_opened', openedValue(1n), 100),
      makeRawEvent('evt-poison', 'position_opened', vec(nativeToScVal('garbage', { type: 'symbol' })), 101),
      makeRawEvent('evt-3', 'position_opened', openedValue(2n), 102),
    ];
    const poller = makePoller(db, router, events);

    const processed = await poller.pollOnce();
    expect(processed).toBe(2);

    const dead = await db.execute('SELECT event_id, contract_id, ledger, stage, error, payload_json FROM dead_letter');
    expect(dead.rows).toHaveLength(1);
    const deadRow = dead.rows[0]!;
    expect(deadRow.event_id).toBe('evt-poison');
    expect(deadRow.contract_id).toBe(FAKE_CONTRACT);
    expect(Number(deadRow.ledger)).toBe(101);
    expect(deadRow.stage).toBe('decode');
    expect(String(deadRow.error)).toContain('position_opened.position_id');
    expect(String(deadRow.payload_json)).toContain('valueXdr');

    const rawRows = await db.execute('SELECT event_id FROM events_raw ORDER BY event_id');
    expect(rawRows.rows.map((r) => r.event_id)).toEqual(['evt-1', 'evt-3']);

    const positions = await db.execute('SELECT position_id FROM positions ORDER BY position_id');
    expect(positions.rows.map((r) => Number(r.position_id))).toEqual([1, 2]);

    const cur = await db.execute('SELECT last_ledger, last_pagination_token FROM poll_cursor WHERE id = 1');
    expect(cur.rows).toHaveLength(1);
    expect(Number(cur.rows[0]!.last_ledger)).toBe(102);
    expect(cur.rows[0]!.last_pagination_token).toBe('tok-1');

    await db.close();
  });

  it('archives the raw XDR on events_raw before decoding touches it', async () => {
    const db = await setupDb();
    const router = new EventRouter();
    for (const reg of buildMarketRegistrations(FAKE_CONTRACT)) {
      router.register(reg.contractId, reg.topic, reg.handler);
    }
    const raw = makeRawEvent('evt-xdr', 'position_opened', openedValue(7n), 100);
    const poller = makePoller(db, router, [raw]);
    await poller.pollOnce();

    const rows = await db.execute("SELECT topic_xdr, value_xdr, payload_json FROM events_raw WHERE event_id = 'evt-xdr'");
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0]!;
    const topicXdr = JSON.parse(String(row.topic_xdr)) as string[];
    expect(topicXdr).toHaveLength(1);
    expect(String(row.value_xdr).length).toBeGreaterThan(0);
    // The archive is the recovery path — it must decode back to the original ScVal.
    const revived = xdr.ScVal.fromXDR(String(row.value_xdr), 'base64');
    expect(revived.switch().name).toBe('scvVec');
    // And the XDR must not leak into the decoded payload column.
    expect(String(row.payload_json)).not.toContain('valueXdr');

    await db.close();
  });

  it('dead-letters handler failures and rethrows so the cursor does not advance', async () => {
    const db = await setupDb();
    const router = new EventRouter();
    router.register(FAKE_CONTRACT, 'position_opened', async () => {
      throw new Error('projection exploded');
    });

    const events = [makeRawEvent('evt-apply', 'position_opened', openedValue(1n), 100)];
    const poller = makePoller(db, router, events);

    await expect(poller.pollOnce()).rejects.toThrow('projection exploded');

    const dead = await db.execute('SELECT event_id, stage, error FROM dead_letter');
    expect(dead.rows).toHaveLength(1);
    expect(dead.rows[0]!.event_id).toBe('evt-apply');
    expect(dead.rows[0]!.stage).toBe('apply');
    expect(String(dead.rows[0]!.error)).toContain('projection exploded');

    const cur = await db.execute('SELECT * FROM poll_cursor');
    expect(cur.rows).toHaveLength(0);

    await db.close();
  });
});

describe('poller retention-gap handling', () => {
  it('records a ledger gap and clamps the cursor when the retention window passed it', async () => {
    const db = await setupDb();
    const router = new EventRouter();
    await writeCursor(db, { lastLedger: 100, lastPagingToken: 'stale-tok', updatedAt: Date.now() }, null);

    const rpc = {
      getEvents: vi.fn(async () => {
        throw new Error('startLedger must be within the ledger range: 500 - 900');
      }),
      getLatestLedger: vi.fn(async () => ({ sequence: 900 })),
    };
    const poller = new IndexerPoller({
      db,
      rpcPool: new RpcPool([rpc as never], ['fake://rpc']),
      bus: new IndexerBus(),
      router,
      log: noopLogger,
      contractIds: [FAKE_CONTRACT],
      marketContract: FAKE_CONTRACT,
      pollIntervalMs: 10,
      coldStartLedgers: 100,
    }) as unknown as PollerHandle;

    const processed = await poller.pollOnce();
    expect(processed).toBe(0);

    const gaps = await db.execute('SELECT from_ledger, to_ledger, reason FROM ledger_gaps');
    expect(gaps.rows).toHaveLength(1);
    expect(Number(gaps.rows[0]!.from_ledger)).toBe(100);
    expect(Number(gaps.rows[0]!.to_ledger)).toBe(499);
    expect(gaps.rows[0]!.reason).toBe('rpc_retention');

    const cur = await db.execute('SELECT last_ledger, last_pagination_token FROM poll_cursor WHERE id = 1');
    expect(Number(cur.rows[0]!.last_ledger)).toBe(500);
    expect(cur.rows[0]!.last_pagination_token).toBeNull();

    // The poller carries on — no fatal state, next poll starts at 500.
    expect(poller.health().fatal).toBeNull();
    expect(poller.health().running).toBe(false); // never started — but not stopped by the gap

    await db.close();
  });
});

describe('poller cursor CAS', () => {
  it('stops on a CAS miss instead of clobbering a second writer', async () => {
    const db = await setupDb();
    await writeCursor(db, { lastLedger: 100, lastPagingToken: null, updatedAt: Date.now() }, null);

    const router = new EventRouter();
    for (const reg of buildMarketRegistrations(FAKE_CONTRACT)) {
      router.register(reg.contractId, reg.topic, reg.handler);
    }
    // Simulate a concurrent poller: mid-batch, someone else moves the cursor.
    router.register(FAKE_CONTRACT, 'position_opened', async (_event, c) => {
      await c.db.execute('UPDATE poll_cursor SET last_ledger = 999 WHERE id = 1');
    });

    const events = [makeRawEvent('evt-cas', 'position_opened', openedValue(9n), 150)];
    const poller = makePoller(db, router, events);

    await poller.pollOnce();

    expect(poller.health().fatal).toBe('cursor_cas_miss');
    expect(poller.health().running).toBe(false);

    // The foreign write is preserved, not clobbered.
    const cur = await db.execute('SELECT last_ledger FROM poll_cursor WHERE id = 1');
    expect(Number(cur.rows[0]!.last_ledger)).toBe(999);

    await db.close();
  });
});
