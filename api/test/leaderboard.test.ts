import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { setupTestServer } from './helpers.js';

let app: Awaited<ReturnType<typeof setupTestServer>>['app'] | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

const A = Keypair.random().publicKey();
const B = Keypair.random().publicKey();
const C = Keypair.random().publicKey();

interface Leader {
  trader: string;
  pnl: string;
  volume: string;
}

// A: pnl 500 + (-100) = 400 ; volume opens(100+200)+closes(100+200) = 600
// B: pnl 50               ; volume 1000 + 1000 = 2000
// C: pnl 1000             ; volume 50 + 50 = 100
beforeEach(async () => {
  const setup = await setupTestServer({
    seedEvents: [
      { eventId: 'oA1', topic: 'position_opened', ledger: 1, payload: { positionId: 1, trader: A, asset: 'BTC', direction: 0, size: '100', entryPrice: '1' } },
      { eventId: 'oA2', topic: 'position_opened', ledger: 2, payload: { positionId: 2, trader: A, asset: 'BTC', direction: 0, size: '200', entryPrice: '1' } },
      { eventId: 'oB1', topic: 'position_opened', ledger: 3, payload: { positionId: 3, trader: B, asset: 'ETH', direction: 1, size: '1000', entryPrice: '1' } },
      { eventId: 'oC1', topic: 'position_opened', ledger: 4, payload: { positionId: 4, trader: C, asset: 'BTC', direction: 0, size: '50', entryPrice: '1' } },
      { eventId: 'cA1', topic: 'position_closed', ledger: 10, payload: { positionId: 1, trader: A, pnl: '500', closePrice: '2' } },
      { eventId: 'cA2', topic: 'position_closed', ledger: 11, payload: { positionId: 2, trader: A, pnl: '-100', closePrice: '2' } },
      { eventId: 'cB1', topic: 'position_closed', ledger: 12, payload: { positionId: 3, trader: B, pnl: '50', closePrice: '2' } },
      { eventId: 'cC1', topic: 'position_closed', ledger: 13, payload: { positionId: 4, trader: C, pnl: '1000', closePrice: '2' } },
    ],
  });
  app = setup.app;
});

describe('GET /v1/leaderboard', () => {
  it('ranks by realized PnL by default', async () => {
    const res = await app!.inject({ method: 'GET', url: '/v1/leaderboard' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sort: string; leaders: Leader[] };
    expect(body.sort).toBe('pnl');
    expect(body.leaders.map((l) => l.trader)).toEqual([C, A, B]);
    const a = body.leaders.find((l) => l.trader === A)!;
    expect(a.pnl).toBe('400');
    expect(a.volume).toBe('600');
  });

  it('ranks by traded volume when sort=volume', async () => {
    const res = await app!.inject({ method: 'GET', url: '/v1/leaderboard?sort=volume' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sort: string; leaders: Leader[] };
    expect(body.sort).toBe('volume');
    expect(body.leaders.map((l) => l.trader)).toEqual([B, A, C]);
    expect(body.leaders.find((l) => l.trader === B)!.volume).toBe('2000');
  });

  it('honours the limit parameter', async () => {
    const res = await app!.inject({ method: 'GET', url: '/v1/leaderboard?sort=pnl&limit=1' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { leaders: Leader[] };
    expect(body.leaders).toHaveLength(1);
    expect(body.leaders[0]!.trader).toBe(C);
  });

  it('rejects an out-of-range limit', async () => {
    const res = await app!.inject({ method: 'GET', url: '/v1/leaderboard?limit=9999' });
    expect(res.statusCode).toBe(400);
  });

  it('returns an empty board on an empty database', async () => {
    if (app) await app.close();
    const setup = await setupTestServer();
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/leaderboard' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { leaders: Leader[] }).leaders).toEqual([]);
  });

  it('reports trade + liquidation counts per trader', async () => {
    const res = await app!.inject({ method: 'GET', url: '/v1/leaderboard' });
    const body = res.json() as { leaders: (Leader & { trades: number; liqCount: number })[] };
    const a = body.leaders.find((l) => l.trader === A)!;
    expect(a.trades).toBe(2);
    expect(a.liqCount).toBe(0);
  });

  it('scopes to the configured market contract (retired deployments excluded)', async () => {
    if (app) await app.close();
    const RETIRED = 'CAE3U7JKESRWZHPEQ72DVNGOQ6WPA7HSPQZL5YV46NPCE4TMUPAGYMEC';
    const setup = await setupTestServer({
      seedEvents: [
        // Live market (default FAKE_CONTRACT): one open for A.
        { eventId: 'live1', topic: 'position_opened', ledger: 1, payload: { positionId: 1, trader: A, asset: 'BTC', direction: 0, size: '100', entryPrice: '1' } },
        // Retired deployment: huge volume that must NOT count.
        { eventId: 'old1', topic: 'position_opened', ledger: 2, contractId: RETIRED, payload: { positionId: 1, trader: A, asset: 'BTC', direction: 0, size: '999999', entryPrice: '1' } },
        { eventId: 'old2', topic: 'position_closed', ledger: 3, contractId: RETIRED, payload: { positionId: 1, trader: A, pnl: '777', closePrice: '2' } },
      ],
    });
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/leaderboard?sort=volume' });
    const body = res.json() as { leaders: (Leader & { trades: number })[] };
    const a = body.leaders.find((l) => l.trader === A)!;
    expect(a.volume).toBe('100');
    expect(a.pnl).toBe('0');
    expect(a.trades).toBe(1);
  });

  it('merges the leaderboard_legacy baseline and exposes updatedAt', async () => {
    if (app) await app.close();
    const setup = await setupTestServer({
      seedEvents: [
        { eventId: 'm1', topic: 'position_opened', ledger: 1, payload: { positionId: 1, trader: A, asset: 'BTC', direction: 0, size: '100', entryPrice: '1' } },
      ],
    });
    app = setup.app;
    await setup.db.execute({
      sql: `INSERT INTO leaderboard_legacy (address, trade_count, total_volume, total_pnl, liq_count, imported_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [A, 5, '900', '42', 1, Date.now()],
    });
    await setup.db.execute({
      sql: 'INSERT INTO poll_cursor (id, last_ledger, updated_at) VALUES (1, ?, ?)',
      args: [123, 1_783_400_000_000],
    });
    const res = await app.inject({ method: 'GET', url: '/v1/leaderboard?sort=volume' });
    const body = res.json() as {
      updatedAt: number | null;
      leaders: (Leader & { trades: number; liqCount: number })[];
    };
    const a = body.leaders.find((l) => l.trader === A)!;
    expect(a.volume).toBe('1000'); // 100 live + 900 legacy
    expect(a.pnl).toBe('42');
    expect(a.trades).toBe(6); // 1 live + 5 legacy
    expect(a.liqCount).toBe(1);
    expect(body.updatedAt).toBe(1_783_400_000); // ms → unix seconds
  });
});

interface Totals {
  updatedAt: number | null;
  traders: number;
  volume: string;
  trades: number;
}

describe('GET /v1/leaderboard/totals', () => {
  it('matches the summed board while every trader fits on one page', async () => {
    const board = (await app!.inject({ method: 'GET', url: '/v1/leaderboard?sort=volume&limit=200' }))
      .json() as { leaders: (Leader & { trades: number })[] };
    const totals = (await app!.inject({ method: 'GET', url: '/v1/leaderboard/totals' })).json() as Totals;

    expect(totals.traders).toBe(board.leaders.length);
    expect(BigInt(totals.volume)).toBe(board.leaders.reduce((s, l) => s + BigInt(l.volume), 0n));
    expect(totals.trades).toBe(board.leaders.reduce((s, l) => s + l.trades, 0));
  });

  it('counts every trader past the page limit (the bug this endpoint exists for)', async () => {
    if (app) await app.close();
    const TRADERS = 250; // > MAX_LEADERBOARD_LIMIT (200)
    const traders = Array.from({ length: TRADERS }, () => Keypair.random().publicKey());
    const seedEvents = traders.flatMap((t, i) => [
      {
        eventId: `o${i}`,
        topic: 'position_opened',
        ledger: i + 1,
        payload: { positionId: i + 1, trader: t, asset: 'BTC', direction: 0, size: '10', entryPrice: '1' },
      },
      {
        eventId: `c${i}`,
        topic: 'position_closed',
        ledger: TRADERS + i + 1,
        payload: { positionId: i + 1, trader: t, pnl: '1', closePrice: '2' },
      },
    ]);
    const setup = await setupTestServer({ seedEvents });
    app = setup.app;

    const board = (await app.inject({ method: 'GET', url: '/v1/leaderboard?sort=volume&limit=200' }))
      .json() as { leaders: (Leader & { trades: number })[] };
    const totals = (await app.inject({ method: 'GET', url: '/v1/leaderboard/totals' })).json() as Totals;

    // The ranked page truncates — that is by design and is exactly why summing
    // it undercounts.
    expect(board.leaders).toHaveLength(200);
    expect(board.leaders.reduce((s, l) => s + BigInt(l.volume), 0n)).toBe(200n * 20n);

    // The aggregate does not.
    expect(totals.traders).toBe(TRADERS);
    expect(totals.trades).toBe(TRADERS); // opens only; closes add none
    expect(BigInt(totals.volume)).toBe(BigInt(TRADERS) * 20n); // open leg + close leg
  });

  it('folds in the legacy baseline, including traders with no live events', async () => {
    if (app) await app.close();
    const setup = await setupTestServer({
      seedEvents: [
        { eventId: 'm1', topic: 'position_opened', ledger: 1, payload: { positionId: 1, trader: A, asset: 'BTC', direction: 0, size: '100', entryPrice: '1' } },
      ],
    });
    app = setup.app;
    await setup.db.execute({
      sql: `INSERT INTO leaderboard_legacy (address, trade_count, total_volume, total_pnl, liq_count, imported_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [B, 5, '900', '42', 1, Date.now()],
    });

    const totals = (await app.inject({ method: 'GET', url: '/v1/leaderboard/totals' })).json() as Totals;
    expect(totals.traders).toBe(2); // A live + B legacy-only
    expect(totals.trades).toBe(6); // 1 live + 5 legacy
    expect(totals.volume).toBe('1000'); // 100 live + 900 legacy
  });

  it('scopes to the configured market contract', async () => {
    if (app) await app.close();
    const RETIRED = 'CAE3U7JKESRWZHPEQ72DVNGOQ6WPA7HSPQZL5YV46NPCE4TMUPAGYMEC';
    const setup = await setupTestServer({
      seedEvents: [
        { eventId: 'live1', topic: 'position_opened', ledger: 1, payload: { positionId: 1, trader: A, asset: 'BTC', direction: 0, size: '100', entryPrice: '1' } },
        { eventId: 'old1', topic: 'position_opened', ledger: 2, contractId: RETIRED, payload: { positionId: 1, trader: C, asset: 'BTC', direction: 0, size: '999999', entryPrice: '1' } },
      ],
    });
    app = setup.app;
    const totals = (await app.inject({ method: 'GET', url: '/v1/leaderboard/totals' })).json() as Totals;
    expect(totals.traders).toBe(1);
    expect(totals.volume).toBe('100');
    expect(totals.trades).toBe(1);
  });

  it('returns zeroes on an empty database', async () => {
    if (app) await app.close();
    const setup = await setupTestServer();
    app = setup.app;
    const totals = (await app.inject({ method: 'GET', url: '/v1/leaderboard/totals' })).json() as Totals;
    expect(totals).toMatchObject({ traders: 0, volume: '0', trades: 0 });
  });
});
