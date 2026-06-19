import { describe, it, expect, vi } from 'vitest';
import { createClient } from '@libsql/client';
import type { Logger } from 'pino';
import { runMigrations } from '../src/migrations.js';
import { writeCursor, readCursor } from '../src/cursor.js';
import { IndexerBus } from '../src/bus.js';

const MARKET = 'CCVDWH4ZL4RNVD52CWQ2LABTLUFFF4VLTXIT5LR7AQSLIB7YOZCOFMOD';

// A malformed payload surfaces as a throwing decoder. Mock the market decoder
// so the event with id 'bad' throws while the rest decode to a minimal event.
vi.mock('../src/decoders/market.js', () => ({
  decodeMarketEvent: (raw: { id: string; contractId: string; ledger: number }) => {
    if (raw.id === 'bad') throw new Error('malformed payload xdr');
    return {
      id: raw.id,
      contractId: raw.contractId,
      topic: 'position_opened',
      ledger: raw.ledger,
      ledgerCloseTs: 0,
      txHash: 't',
    };
  },
}));

import { IndexerPoller } from '../src/poll.js';

const noopLogger: Logger = {
  level: 'silent',
  fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(),
  silent: vi.fn(), child: () => noopLogger,
} as unknown as Logger;

function fakeRpc(events: unknown[]) {
  return {
    getEvents: async () => ({ events, latestLedger: 200, cursor: 'next-token' }),
    getLatestLedger: async () => ({ sequence: 200 }),
  } as never;
}

function rawEvent(id: string, ledger: number) {
  return {
    id,
    contractId: MARKET,
    topic: [],
    value: {},
    ledger,
    ledgerClosedAt: '2026-01-01T00:00:00Z',
  };
}

describe('poller dead-letter isolation (P0-15)', () => {
  it('dead-letters a malformed event and keeps processing the batch', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrations(db);
    // Pre-seed a cursor so the cold-start path (getLatestLedger) is skipped.
    await writeCursor(db, { lastLedger: 99, lastPagingToken: 'tok', updatedAt: Date.now() });

    const dispatched: string[] = [];
    const router = { dispatch: async (e: { id: string }) => { dispatched.push(e.id); } };

    const events = [rawEvent('good-1', 100), rawEvent('bad', 101), rawEvent('good-2', 102)];

    const poller = new IndexerPoller({
      db,
      rpc: fakeRpc(events),
      bus: new IndexerBus(),
      router: router as never,
      log: noopLogger,
      contractIds: [MARKET],
      marketContract: MARKET,
      pollIntervalMs: 1000,
      coldStartLedgers: 100,
    });

    // Must resolve (not throw) even though one event fails to decode.
    const processed = await poller.pollOnce();

    expect(processed).toBe(2);
    expect(dispatched).toEqual(['good-1', 'good-2']);

    const dl = await db.execute('SELECT event_id, ledger, error FROM dead_letter');
    expect(dl.rows).toHaveLength(1);
    expect(dl.rows[0]!.event_id).toBe('bad');
    expect(Number(dl.rows[0]!.ledger)).toBe(101);
    expect(String(dl.rows[0]!.error)).toContain('malformed payload');

    // Cursor advanced past the whole batch — the poller did not wedge.
    const cursor = await readCursor(db);
    expect(cursor?.lastPagingToken).toBe('next-token');
    expect(cursor?.lastLedger).toBe(102);

    db.close();
  });
});
