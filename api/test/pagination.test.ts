import { describe, expect, it, afterEach } from 'vitest';
import type { Db } from '@noether/db';
import { Keypair } from '@stellar/stellar-sdk';
import { makeTestDb, setupTestServer } from './helpers.js';

let app: Awaited<ReturnType<typeof setupTestServer>>['app'] | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

const traderA = Keypair.random().publicKey();

describe('cursor pagination (before_ts) — A-7', () => {
  it('/v1/events pages older rows with before_ts', async () => {
    const setup = await setupTestServer({
      seedEvents: [
        { eventId: 'e1', topic: 'position_opened', ledger: 1, ledgerCloseTs: 100, payload: { positionId: 1 } },
        { eventId: 'e2', topic: 'position_opened', ledger: 2, ledgerCloseTs: 200, payload: { positionId: 2 } },
        { eventId: 'e3', topic: 'position_opened', ledger: 3, ledgerCloseTs: 300, payload: { positionId: 3 } },
      ],
    });
    app = setup.app;

    const first = await app.inject({ method: 'GET', url: '/v1/events?limit=2' });
    expect(first.statusCode).toBe(200);
    const firstLedgers = (first.json().events as { ledger: number }[]).map((e) => e.ledger);
    expect(firstLedgers).toEqual([3, 2]);

    // Cursor from the oldest row on page 1 (ts 200) → next older page.
    const older = await app.inject({ method: 'GET', url: '/v1/events?before_ts=200' });
    expect(older.statusCode).toBe(200);
    const olderLedgers = (older.json().events as { ledger: number }[]).map((e) => e.ledger);
    expect(olderLedgers).toEqual([1]);
  });

  it('/v1/trades pages older realized trades with before_ts', async () => {
    const setup = await setupTestServer({
      seedEvents: [
        { eventId: 'o1', topic: 'position_opened', ledger: 10, ledgerCloseTs: 10, payload: { positionId: 1, trader: traderA, asset: 'BTC', direction: 0, size: '100', entryPrice: '1' } },
        { eventId: 'o2', topic: 'position_opened', ledger: 11, ledgerCloseTs: 11, payload: { positionId: 2, trader: traderA, asset: 'BTC', direction: 0, size: '200', entryPrice: '1' } },
        { eventId: 'o3', topic: 'position_opened', ledger: 12, ledgerCloseTs: 12, payload: { positionId: 3, trader: traderA, asset: 'BTC', direction: 0, size: '300', entryPrice: '1' } },
        { eventId: 'c1', topic: 'position_closed', ledger: 200, ledgerCloseTs: 2000, payload: { positionId: 1, trader: traderA, pnl: '1', closePrice: '2' } },
        { eventId: 'c2', topic: 'position_closed', ledger: 201, ledgerCloseTs: 2001, payload: { positionId: 2, trader: traderA, pnl: '2', closePrice: '2' } },
        { eventId: 'c3', topic: 'position_closed', ledger: 202, ledgerCloseTs: 2002, payload: { positionId: 3, trader: traderA, pnl: '3', closePrice: '2' } },
      ],
    });
    app = setup.app;

    const first = await app.inject({ method: 'GET', url: '/v1/trades?limit=2' });
    expect((first.json().trades as { positionId: number }[]).map((t) => t.positionId)).toEqual([3, 2]);

    const older = await app.inject({ method: 'GET', url: '/v1/trades?before_ts=2001' });
    expect(older.statusCode).toBe(200);
    expect((older.json().trades as { positionId: number }[]).map((t) => t.positionId)).toEqual([1]);
  });

  it('/v1/vaults/:id/trades pages older rows with before_ts', async () => {
    const db = makeTestDb();
    await seedVaultTrades(db);
    const setup = await setupTestServer({ db });
    app = setup.app;

    const first = await app.inject({ method: 'GET', url: '/v1/vaults/1/trades' });
    expect(first.statusCode).toBe(200);
    expect((first.json().trades as { ts: number }[]).map((t) => t.ts)).toEqual([30, 20, 10]);

    const older = await app.inject({ method: 'GET', url: '/v1/vaults/1/trades?before_ts=25' });
    expect(older.statusCode).toBe(200);
    expect((older.json().trades as { ts: number }[]).map((t) => t.ts)).toEqual([20, 10]);
  });
});

describe('/v1/positions/open hard LIMIT — A-7', () => {
  it('caps the trader branch at 500 and the global branch at 200', async () => {
    const db = makeTestDb();
    const setup = await setupTestServer({ db });
    app = setup.app;

    await db.batch(
      Array.from({ length: 505 }, (_, i) => ({
        sql: `INSERT INTO positions (position_id, trader, asset, direction, size, entry_price, opened_at, opened_tx_hash)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [i + 1, traderA, 'BTC', 0, '1', '1', 1000 + i, 't'],
      })),
    );

    const byTrader = await app.inject({ method: 'GET', url: `/v1/positions/open?trader=${traderA}` });
    expect(byTrader.statusCode).toBe(200);
    expect((byTrader.json().positions as unknown[]).length).toBe(500);

    const global = await app.inject({ method: 'GET', url: '/v1/positions/open' });
    expect(global.statusCode).toBe(200);
    expect((global.json().positions as unknown[]).length).toBe(200);
  });
});

async function seedVaultTrades(db: Db): Promise<void> {
  await db.execute(`
    CREATE TABLE vault_trades (
      id BIGINT PRIMARY KEY,
      vault_id BIGINT NOT NULL,
      position_id BIGINT NOT NULL,
      action TEXT NOT NULL,
      leader TEXT NOT NULL,
      collateral TEXT NOT NULL,
      pnl BIGINT,
      ledger BIGINT NOT NULL,
      ts BIGINT NOT NULL,
      tx_hash TEXT NOT NULL
    );
  `);
  for (const [id, ts] of [[1, 10], [2, 20], [3, 30]]) {
    await db.execute({
      sql: `INSERT INTO vault_trades (id, vault_id, position_id, action, leader, collateral, pnl, ledger, ts, tx_hash)
            VALUES (?, 1, ?, 'open', 'L', '1', NULL, ?, ?, 't')`,
      args: [id, String(id), ts, ts],
    });
  }
}
