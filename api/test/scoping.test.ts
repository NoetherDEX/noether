import { describe, expect, it, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { FAKE_CONTRACT, setupTestServer } from './helpers.js';

/**
 * Position ids restart at 1 for every market deployment, so a positionId join
 * that ignores contract_id pairs a close from the live market with opens from
 * retired ones. Measured on the production database before the fix: one close
 * matched up to three opens, /v1/trades returned 34 rows for 13 real closes,
 * one wallet's 14 day volume read +201% high, and /v1/markets/stats carried a
 * phantom bucket named "null" worth about 79,600 dollars because a retired
 * generation emitted opens with no asset field.
 *
 * These tests seed exactly that collision and assert the retired deployment
 * contributes nothing.
 */
const RETIRED = 'CAE3U7JKESRWZHPEQ72DVNGOQ6WPA7HSPQZL5YV46NPCE4TMUPAGYMEC';

let app: Awaited<ReturnType<typeof setupTestServer>>['app'] | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

describe('market scoping across deployments', () => {
  it('keeps a retired deployment out of the 14 day volume preview', async () => {
    const trader = Keypair.random().publicKey();
    const now = Math.floor(Date.now() / 1000);
    const setup = await setupTestServer({
      seedEvents: [
        // Live market: one open and its matching close, both size 100.
        { eventId: 'live_o', topic: 'position_opened', ledger: 1, ledgerCloseTs: now, payload: { positionId: 1, trader, asset: 'BTC', direction: 0, size: '100', entryPrice: '1' } },
        { eventId: 'live_c', topic: 'position_closed', ledger: 2, ledgerCloseTs: now, payload: { positionId: 1, trader, pnl: '5', closePrice: '2' } },
        // Retired deployment reusing position id 1 with an enormous size.
        { eventId: 'old_o', topic: 'position_opened', ledger: 3, ledgerCloseTs: now, contractId: RETIRED, payload: { positionId: 1, trader, asset: 'BTC', direction: 0, size: '999999', entryPrice: '1' } },
        { eventId: 'old_c', topic: 'position_closed', ledger: 4, ledgerCloseTs: now, contractId: RETIRED, payload: { positionId: 1, trader, pnl: '1', closePrice: '2' } },
      ],
    });
    app = setup.app;

    const res = await app.inject({ method: 'GET', url: `/v1/account/volume?address=${trader}` });
    expect(res.statusCode).toBe(200);
    // One open of 100 plus one close of 100. Without the fix the close also
    // paired with the retired open and the retired activity counted too.
    expect(res.json().volume14d).toBe('200');
  });

  it('does not duplicate a trade or borrow a retired open for its fields', async () => {
    const trader = Keypair.random().publicKey();
    const now = Math.floor(Date.now() / 1000);
    const setup = await setupTestServer({
      seedEvents: [
        { eventId: 'l_o', topic: 'position_opened', ledger: 1, ledgerCloseTs: now, payload: { positionId: 7, trader, asset: 'XLM', direction: 0, size: '50', entryPrice: '1' } },
        { eventId: 'l_c', topic: 'position_closed', ledger: 2, ledgerCloseTs: now, payload: { positionId: 7, trader, pnl: '3', closePrice: '2' } },
        // Same id on a retired deployment, different asset and size.
        { eventId: 'r_o', topic: 'position_opened', ledger: 3, ledgerCloseTs: now, contractId: RETIRED, payload: { positionId: 7, trader, asset: 'BTC', direction: 1, size: '888', entryPrice: '9' } },
      ],
    });
    app = setup.app;

    const res = await app.inject({ method: 'GET', url: `/v1/trades?trader=${trader}` });
    expect(res.statusCode).toBe(200);
    const closes = res.json().trades.filter((t: { kind: string }) => t.kind === 'close');
    expect(closes).toHaveLength(1);
    // The surviving row must describe the live market's position, not BTC/888.
    expect(closes[0].asset).toBe('XLM');
    expect(closes[0].size).toBe('50');
  });

  it('excludes retired open interest and never invents a null asset bucket', async () => {
    const trader = Keypair.random().publicKey();
    const now = Math.floor(Date.now() / 1000);
    const setup = await setupTestServer({
      seedEvents: [
        { eventId: 'v_live', topic: 'position_opened', ledger: 1, ledgerCloseTs: now, payload: { positionId: 1, trader, asset: 'BTC', direction: 0, size: '100', entryPrice: '1' } },
        // A retired generation whose opens carry no asset at all. Unscoped,
        // this produced a bucket literally keyed "null".
        { eventId: 'v_old', topic: 'position_opened', ledger: 2, ledgerCloseTs: now, contractId: RETIRED, payload: { positionId: 2, trader, size: '4242', entryPrice: '1' } },
      ],
    });
    app = setup.app;
    await setup.db.execute({
      sql: `INSERT INTO positions (position_id, trader, asset, direction, size, entry_price, opened_at, opened_tx_hash, contract_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [99, trader, 'BTC', 0, '777', '1', now, 'tx', RETIRED],
    });

    const res = await app.inject({ method: 'GET', url: '/v1/markets/stats' });
    expect(res.statusCode).toBe(200);
    const stats = res.json().stats as { asset: string; volume24h: string; openInterestLong: string }[];

    expect(stats.some((s) => s.asset === 'null' || s.asset == null)).toBe(false);
    const btc = stats.find((s) => s.asset === 'BTC');
    expect(btc?.volume24h).toBe('100');
    // The retired position row must not show up as live open interest.
    expect(btc?.openInterestLong).toBe('0');
  });
});
