import { describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createPgliteDb } from '@noether/db/pglite';
import type { Logger } from 'pino';
import { IndexerBus } from '../src/bus.js';
import { EventRouter, type HandlerContext } from '../src/router.js';
import { buildMarketRegistrations } from '../src/handlers/market.js';
import { runMigrations } from '../src/migrations.js';
import { reindexProjections } from '../src/reindex.js';
import type { PositionClosedEvent, PositionOpenedEvent } from '../src/types/events.js';

const FAKE_CONTRACT = 'CCVDWH4ZL4RNVD52CWQ2LABTLUFFF4VLTXIT5LR7AQSLIB7YOZCOFMOD';
const FAKE_TRADER = 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN';

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

function opened(id: string, positionId: number, ledger: number): PositionOpenedEvent {
  return {
    id,
    contractId: FAKE_CONTRACT,
    topic: 'position_opened',
    ledger,
    ledgerCloseTs: 1745923200 + ledger,
    txHash: 'a'.repeat(64),
    positionId,
    trader: FAKE_TRADER,
    asset: 'BTC',
    direction: 0,
    size: 100n,
    entryPrice: 60n,
  };
}

function closed(id: string, positionId: number, ledger: number): PositionClosedEvent {
  return {
    id,
    contractId: FAKE_CONTRACT,
    topic: 'position_closed',
    ledger,
    ledgerCloseTs: 1745923200 + ledger,
    txHash: 'b'.repeat(64),
    positionId,
    trader: FAKE_TRADER,
    asset: 'BTC',
    direction: 0,
    size: 100n,
    entryPrice: 60n,
    closePrice: 58n,
    pnl: -2n,
  };
}

describe('reindexProjections', () => {
  it('rebuilds projections from events_raw with the bus suppressed', async () => {
    const db = await setupDb();

    const router = new EventRouter();
    for (const reg of buildMarketRegistrations(FAKE_CONTRACT)) {
      router.register(reg.contractId, reg.topic, reg.handler);
    }

    // Live indexing pass populates events_raw + projections.
    const liveCtx: HandlerContext = { db, rpc: {} as never, bus: new IndexerBus(), log: noopLogger };
    await router.dispatch(opened('evt-1', 1, 100), liveCtx);
    await router.dispatch(opened('evt-2', 2, 101), liveCtx);
    await router.dispatch(closed('evt-3', 2, 102), liveCtx);

    // Simulate projection corruption from a (now fixed) handler bug.
    await db.execute('DELETE FROM positions');

    const bus = new IndexerBus();
    const spy = vi.fn();
    bus.on('event', spy);
    bus.on('trade', spy);
    bus.on('position', spy);

    const result = await reindexProjections(db, router, {} as never, noopLogger, bus);
    expect(result.replayed).toBe(3);
    expect(result.failed).toBe(0);
    expect(spy).not.toHaveBeenCalled();

    const rows = await db.execute('SELECT position_id, contract_id FROM positions');
    expect(rows.rows.map((r) => Number(r.position_id))).toEqual([1]);
    expect(rows.rows[0]!.contract_id).toBe(FAKE_CONTRACT);

    // events_raw is the archive — replay must not duplicate or drop it.
    const raw = await db.execute('SELECT COUNT(*) AS n FROM events_raw');
    expect(Number(raw.rows[0]!.n)).toBe(3);

    // The realized-trade projection rebuilds from the archived close,
    // revived through the same string-typed payload as the live path.
    const trades = await db.execute('SELECT position_id, asset, kind, pnl FROM trades');
    expect(trades.rows).toHaveLength(1);
    expect(Number(trades.rows[0]!.position_id)).toBe(2);
    expect(trades.rows[0]!.asset).toBe('BTC');
    expect(trades.rows[0]!.kind).toBe('close');
    expect(String(trades.rows[0]!.pnl)).toBe('-2');

    await db.close();
  });

  it('skips events from contracts that are no longer registered', async () => {
    const db = await setupDb();

    const OLD_CONTRACT = 'CC2HH34Q7GOMNBNPSNSQIIUSYYXLYLOOLMUY3ZTFFBLJ2DENWHGS6GNB';
    const oldRouter = new EventRouter();
    for (const reg of buildMarketRegistrations(OLD_CONTRACT)) {
      oldRouter.register(reg.contractId, reg.topic, reg.handler);
    }
    const liveCtx: HandlerContext = { db, rpc: {} as never, bus: new IndexerBus(), log: noopLogger };
    await oldRouter.dispatch({ ...opened('evt-old', 7, 90), contractId: OLD_CONTRACT }, liveCtx);

    const newRouter = new EventRouter();
    for (const reg of buildMarketRegistrations(FAKE_CONTRACT)) {
      newRouter.register(reg.contractId, reg.topic, reg.handler);
    }
    await newRouter.dispatch(opened('evt-new', 8, 100), liveCtx);

    const result = await reindexProjections(db, newRouter, {} as never, noopLogger);
    expect(result.failed).toBe(0);

    // Only the current contract's position survives the rebuild —
    // zombie rows from the old deployment are gone without a
    // hand-written repair migration.
    const rows = await db.execute('SELECT position_id FROM positions');
    expect(rows.rows.map((r) => Number(r.position_id))).toEqual([8]);

    await db.close();
  });
});
