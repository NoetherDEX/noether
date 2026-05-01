import { describe, expect, it, afterEach } from 'vitest';
import { createClient } from '@libsql/client';
import { setupTestServer } from './helpers.js';

const FAKE_CONTRACT = 'CCVDWH4ZL4RNVD52CWQ2LABTLUFFF4VLTXIT5LR7AQSLIB7YOZCOFMOD';

async function seedEvents(db: ReturnType<typeof createClient>): Promise<void> {
  await db.execute(`
    CREATE TABLE events_raw (
      event_id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      ledger INTEGER NOT NULL,
      ledger_close_ts INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      inserted_at INTEGER NOT NULL
    );
  `);
  const rows = [
    ['e1', 'position_opened', 100, '{"positionId":1}'],
    ['e2', 'position_opened', 102, '{"positionId":2}'],
    ['e3', 'position_closed', 105, '{"positionId":1,"pnl":"50"}'],
    ['e4', 'order_placed', 108, '{"orderId":7}'],
  ];
  for (const [id, topic, ledger, payload] of rows) {
    await db.execute({
      sql: `INSERT INTO events_raw (event_id, contract_id, topic, ledger, ledger_close_ts, tx_hash, payload_json, inserted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, FAKE_CONTRACT, topic, ledger as number, 1745923200, 't', payload, Date.now()],
    });
  }
}

let app: Awaited<ReturnType<typeof setupTestServer>>['app'] | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

describe('events route', () => {
  it('GET /v1/events returns recent events', async () => {
    const db = createClient({ url: ':memory:' });
    await seedEvents(db);
    const setup = await setupTestServer({ db });
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/events?limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toHaveLength(4);
    expect(body.events[0].topic).toBe('order_placed');
    expect(body.events[0].ledger).toBe(108);
  });

  it('filters by topic', async () => {
    const db = createClient({ url: ':memory:' });
    await seedEvents(db);
    const setup = await setupTestServer({ db });
    app = setup.app;
    const res = await app.inject({
      method: 'GET',
      url: '/v1/events?topic=position_opened',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toHaveLength(2);
    for (const e of body.events) {
      expect(e.topic).toBe('position_opened');
    }
  });

  it('filters by ledger range', async () => {
    const db = createClient({ url: ':memory:' });
    await seedEvents(db);
    const setup = await setupTestServer({ db });
    app = setup.app;
    const res = await app.inject({
      method: 'GET',
      url: '/v1/events?from_ledger=102&to_ledger=105',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ledgers = body.events.map((e: { ledger: number }) => e.ledger).sort();
    expect(ledgers).toEqual([102, 105]);
  });
});
