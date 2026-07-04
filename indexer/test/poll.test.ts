import { describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import type { Logger } from 'pino';
import { IndexerBus } from '../src/bus.js';
import { EventRouter } from '../src/router.js';
import { buildMarketRegistrations } from '../src/handlers/market.js';
import { runMigrations } from '../src/migrations.js';
import { IndexerPoller } from '../src/poll.js';
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
  const db = createClient({ url: ':memory:' });
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
    nativeToScVal(0n, { type: 'u32' }),
    nativeToScVal(1_500_0000000n, { type: 'i128' }),
    nativeToScVal(60_000_0000000n, { type: 'i128' }),
  );
}

function makePoller(db: Client, router: EventRouter, events: RawEvent[]) {
  const rpc = {
    getEvents: vi.fn(async () => ({ events, cursor: 'tok-1', latestLedger: 200 })),
    getLatestLedger: vi.fn(async () => ({ sequence: 150 })),
  };
  const poller = new IndexerPoller({
    db,
    rpc: rpc as never,
    bus: new IndexerBus(),
    router,
    log: noopLogger,
    contractIds: [FAKE_CONTRACT],
    marketContract: FAKE_CONTRACT,
    pollIntervalMs: 10,
    coldStartLedgers: 100,
  });
  return poller as unknown as { pollOnce(): Promise<number> };
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

    db.close();
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

    db.close();
  });
});
