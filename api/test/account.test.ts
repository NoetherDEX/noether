import { describe, expect, it, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { setupTestServer } from './helpers.js';

let app: Awaited<ReturnType<typeof setupTestServer>>['app'] | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

const INSERT_EVENT = `INSERT INTO events_raw (event_id, contract_id, topic, ledger, ledger_close_ts, tx_hash, payload_json, inserted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

describe('account/me/positions and /me/orders scale past the global event window', () => {
  it('returns the trader rows even when 600 newer global events exist', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const kp = Keypair.random();
    const address = kp.publicKey();
    const other = Keypair.random().publicKey();

    // One old position event + one old order event for our trader.
    await setup.db.execute({
      sql: INSERT_EVENT,
      args: [
        'mine-pos', 'C', 'position_opened', 10, 1, 't',
        JSON.stringify({ trader: address, positionId: 1, asset: 'BTC', direction: 0, size: '100', entryPrice: '50' }),
        Date.now(),
      ],
    });
    await setup.db.execute({
      sql: INSERT_EVENT,
      args: [
        'mine-ord', 'C', 'order_placed', 11, 1, 't',
        JSON.stringify({ trader: address, orderId: 7, triggerPrice: '123' }),
        Date.now(),
      ],
    });

    // Flood 600 newer events from another trader — enough to scroll the old
    // rows out of any latest-200/500 global window.
    await setup.db.batch(
      Array.from({ length: 600 }, (_, i) => ({
        sql: INSERT_EVENT,
        args: [
          `flood-${i}`, 'C', 'position_opened', 1000 + i, 1, 't',
          JSON.stringify({ trader: other, positionId: 100 + i, asset: 'BTC', direction: 0, size: '1', entryPrice: '1' }),
          Date.now(),
        ],
      })),
    );

    // The trader's position is still open in the indexer projection.
    await setup.db.execute({
      sql: `INSERT INTO positions (position_id, trader, asset, direction, size, entry_price, opened_at, opened_tx_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [1, address, 'BTC', 0, '100', '50', 1745923200, 't'],
    });

    const issued = await setup.deps.apiKeys.issue(address, 'account-test');
    const headers = { authorization: `Bearer ${issued.keyId}:${issued.secret}` };

    const posRes = await app.inject({ method: 'GET', url: '/v1/account/me/positions', headers });
    expect(posRes.statusCode).toBe(200);
    const posBody = posRes.json() as {
      positions: Array<{ positionId: number; trader: string; asset: string; entryPrice: string }>;
      events: Array<{ eventId: string }>;
    };
    expect(posBody.positions).toHaveLength(1);
    expect(posBody.positions[0]).toMatchObject({ positionId: 1, trader: address, asset: 'BTC', entryPrice: '50' });
    expect(posBody.events.map((e) => e.eventId)).toContain('mine-pos');

    const ordRes = await app.inject({ method: 'GET', url: '/v1/account/me/orders', headers });
    expect(ordRes.statusCode).toBe(200);
    const ordBody = ordRes.json() as { events: Array<{ eventId: string; payload: { orderId: number } }> };
    expect(ordBody.events).toHaveLength(1);
    expect(ordBody.events[0]!.eventId).toBe('mine-ord');
    expect(ordBody.events[0]!.payload.orderId).toBe(7);
  });

  it('does not leak another trader rows and stays empty for inactive wallets', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const kp = Keypair.random();
    const address = kp.publicKey();
    const other = Keypair.random().publicKey();

    await setup.db.execute({
      sql: INSERT_EVENT,
      args: [
        'other-ord', 'C', 'order_placed', 20, 1, 't',
        JSON.stringify({ trader: other, orderId: 3, triggerPrice: '9' }),
        Date.now(),
      ],
    });
    await setup.db.execute({
      sql: `INSERT INTO positions (position_id, trader, asset, direction, size, entry_price, opened_at, opened_tx_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [9, other, 'ETH', 1, '5', '2000', 1745923200, 't'],
    });

    const issued = await setup.deps.apiKeys.issue(address, 'account-test');
    const headers = { authorization: `Bearer ${issued.keyId}:${issued.secret}` };

    const posRes = await app.inject({ method: 'GET', url: '/v1/account/me/positions', headers });
    expect(posRes.statusCode).toBe(200);
    expect(posRes.json()).toEqual({ positions: [], events: [] });

    const ordRes = await app.inject({ method: 'GET', url: '/v1/account/me/orders', headers });
    expect(ordRes.statusCode).toBe(200);
    expect(ordRes.json()).toEqual({ events: [] });
  });
});
