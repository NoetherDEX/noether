import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Client } from '@libsql/client';
import { setupTestServer } from './helpers.js';

/** Insert a position_opened event with a controlled age so the 24h window is testable. */
async function seedOpen(
  db: Client,
  id: string,
  trader: string,
  asset: string,
  size: string,
  agoSec: number,
): Promise<void> {
  const ts = Math.floor(Date.now() / 1000) - agoSec;
  await db.execute({
    sql: `INSERT INTO events_raw (event_id, contract_id, topic, ledger, ledger_close_ts, tx_hash, payload_json, inserted_at)
          VALUES (?, 'c', 'position_opened', 1, ?, 't', ?, ?)`,
    args: [id, ts, JSON.stringify({ topic: 'position_opened', trader, asset, size }), Date.now()],
  });
}

describe('stats routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it('GET /v1/stats aggregates total + 24h volume, trades, OI and unique traders', async () => {
    const setup = await setupTestServer({});
    app = setup.app;
    const db = setup.db;
    await db.execute(`CREATE TABLE IF NOT EXISTS positions (
      position_id INTEGER PRIMARY KEY, trader TEXT, asset TEXT, direction INTEGER,
      size TEXT, entry_price TEXT, opened_at INTEGER, opened_tx_hash TEXT)`);

    await seedOpen(db, 'e1', 'GA', 'BTC', '5000000000', 100); // recent
    await seedOpen(db, 'e2', 'GB', 'BTC', '3000000000', 100); // recent
    await seedOpen(db, 'e3', 'GA', 'ETH', '2000000000', 200_000); // >24h old
    await db.execute(`INSERT INTO positions VALUES (1, 'GA', 'BTC', 0, '5000000000', '600000000000', 1, 't')`);

    const res = await app.inject({ method: 'GET', url: '/v1/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalTrades).toBe(3);
    expect(body.trades24h).toBe(2);
    expect(body.totalVolume).toBe('10000000000'); // 5e9 + 3e9 + 2e9
    expect(body.volume24h).toBe('8000000000'); // 5e9 + 3e9
    expect(body.uniqueTraders).toBe(2); // GA, GB
    expect(body.openInterest).toBe('5000000000');
    expect(body.openPositions).toBe(1);
  });

  it('GET /v1/volume breaks down rolling-24h volume per asset', async () => {
    const setup = await setupTestServer({});
    app = setup.app;
    const db = setup.db;
    await seedOpen(db, 'e1', 'GA', 'BTC', '5000000000', 100);
    await seedOpen(db, 'e2', 'GB', 'ETH', '3000000000', 100);
    await seedOpen(db, 'e3', 'GA', 'BTC', '1000000000', 100);
    await seedOpen(db, 'e4', 'GA', 'XLM', '9000000000', 999_999); // old → excluded

    const res = await app.inject({ method: 'GET', url: '/v1/volume' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.window).toBe('24h');
    expect(body.totalVolume).toBe('9000000000'); // 6e9 BTC + 3e9 ETH
    expect(body.byAsset).toEqual([
      { asset: 'BTC', volume: '6000000000', trades: 2 },
      { asset: 'ETH', volume: '3000000000', trades: 1 },
    ]);
  });

  it('returns zeroed stats on an empty dataset', async () => {
    const setup = await setupTestServer({});
    app = setup.app;
    await setup.db.execute(`CREATE TABLE IF NOT EXISTS positions (
      position_id INTEGER PRIMARY KEY, trader TEXT, asset TEXT, direction INTEGER,
      size TEXT, entry_price TEXT, opened_at INTEGER, opened_tx_hash TEXT)`);
    const res = await app.inject({ method: 'GET', url: '/v1/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalVolume).toBe('0');
    expect(body.totalTrades).toBe(0);
    expect(body.openInterest).toBe('0');
    expect(body.uniqueTraders).toBe(0);
  });
});
