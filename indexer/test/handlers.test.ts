import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { IndexerBus } from '../src/bus.js';
import { EventRouter, type HandlerContext } from '../src/router.js';
import { buildMarketRegistrations } from '../src/handlers/market.js';
import { runMigrations } from '../src/migrations.js';
import type { PositionOpenedEvent } from '../src/types/events.js';
import type { Logger } from 'pino';

const FAKE_CONTRACT = 'CCVDWH4ZL4RNVD52CWQ2LABTLUFFF4VLTXIT5LR7AQSLIB7YOZCOFMOD';
const FAKE_TRADER = 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN';

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

describe('market handler', () => {
  it('persists position_opened to events_raw and emits on bus', async () => {
    const db = await setupDb();
    const bus = new IndexerBus();
    const router = new EventRouter();

    const seenTrade = vi.fn();
    bus.on('trade', seenTrade);
    const seenEvent = vi.fn();
    bus.on('event', seenEvent);

    for (const reg of buildMarketRegistrations(FAKE_CONTRACT)) {
      router.register(reg.contractId, reg.topic, reg.handler);
    }

    const event: PositionOpenedEvent = {
      id: 'evt-1',
      contractId: FAKE_CONTRACT,
      topic: 'position_opened',
      ledger: 100,
      ledgerCloseTs: 1745923200,
      txHash: 'a'.repeat(64),
      positionId: 42,
      trader: FAKE_TRADER,
      size: 1_500_0000000n,
      entryPrice: 60_000_0000000n,
    };

    const ctx: HandlerContext = { db, rpc: {} as never, bus, log: noopLogger };
    await router.dispatch(event, ctx);

    const rows = await db.execute('SELECT event_id, topic, ledger, payload_json FROM events_raw');
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0]!;
    expect(row.event_id).toBe('evt-1');
    expect(row.topic).toBe('position_opened');
    expect(row.ledger).toBe(100);
    const payload = JSON.parse(row.payload_json as string);
    expect(payload.positionId).toBe(42);
    expect(payload.size).toBe('15000000000');

    expect(seenEvent).toHaveBeenCalledOnce();
    expect(seenTrade).toHaveBeenCalledOnce();
    expect(seenTrade.mock.calls[0]?.[0]?.kind).toBe('open');

    db.close();
  });

  it('insert is idempotent on duplicate event_id', async () => {
    const db = await setupDb();
    const bus = new IndexerBus();
    const router = new EventRouter();
    for (const reg of buildMarketRegistrations(FAKE_CONTRACT)) {
      router.register(reg.contractId, reg.topic, reg.handler);
    }

    const event: PositionOpenedEvent = {
      id: 'evt-dup',
      contractId: FAKE_CONTRACT,
      topic: 'position_opened',
      ledger: 100,
      ledgerCloseTs: 1745923200,
      txHash: 'a'.repeat(64),
      positionId: 1,
      trader: FAKE_TRADER,
      size: 100n,
      entryPrice: 60n,
    };
    const ctx: HandlerContext = { db, rpc: {} as never, bus, log: noopLogger };
    await router.dispatch(event, ctx);
    await router.dispatch(event, ctx);

    const rows = await db.execute('SELECT COUNT(*) AS n FROM events_raw');
    expect(Number(rows.rows[0]!.n)).toBe(1);

    db.close();
  });
});
