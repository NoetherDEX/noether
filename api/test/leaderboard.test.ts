import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { setupTestServer } from './helpers.js';

interface PageLeader {
  rank: number;
  trader: string;
  pnl: string;
  volume: string;
  trades: number;
  liqCount: number;
}

interface PageBody {
  sort: string;
  scope: string;
  network: string;
  state: string;
  updatedAt: number | null;
  total: number;
  limit: number;
  offset: number;
  snapshot: string;
  snapshotChanged: boolean;
  leaders: PageLeader[];
}

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

describe('GET /v1/leaderboard pagination', () => {
  it('concatenated pages of 20 equal the full board with unique consecutive ranks', async () => {
    if (app) await app.close();
    const N = 47;
    const traders = Array.from({ length: N }, () => Keypair.random().publicKey());
    // Distinct volumes so the primary sort alone is already a total order.
    const seedEvents = traders.map((t, i) => ({
      eventId: `o${i}`,
      topic: 'position_opened',
      ledger: i + 1,
      payload: { positionId: i + 1, trader: t, asset: 'BTC', direction: 0, size: String((i + 1) * 10), entryPrice: '1' },
    }));
    const setup = await setupTestServer({ seedEvents });
    app = setup.app;

    const pages: PageBody[] = [];
    let snapshot = '';
    for (let offset = 0; offset < N; offset += 20) {
      const url = `/v1/leaderboard?sort=volume&limit=20&offset=${offset}${snapshot ? `&snapshot=${snapshot}` : ''}`;
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      const body = res.json() as PageBody;
      expect(body.total).toBe(N);
      expect(body.snapshotChanged).toBe(false);
      if (snapshot) expect(body.snapshot).toBe(snapshot);
      snapshot = body.snapshot;
      pages.push(body);
    }

    expect(pages.map((p) => p.leaders.length)).toEqual([20, 20, 7]);
    const all = pages.flatMap((p) => p.leaders);
    // Ranks are 1..N with no gap and no duplicate.
    expect(all.map((l) => l.rank)).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    // The union of the pages is exactly the seeded trader set.
    expect(new Set(all.map((l) => l.trader)).size).toBe(N);
    expect(new Set(all.map((l) => l.trader))).toEqual(new Set(traders));
    // Highest volume first.
    expect(all[0]!.volume).toBe(String(N * 10));
  });

  it('keeps a page boundary stable inside a group of pnl ties', async () => {
    if (app) await app.close();
    // 3 winners with distinct positive pnl, then 30 traders at exactly pnl 0
    // whose volumes ALSO tie, so the boundary at rank 20/21 falls inside a
    // group only the trader tiebreak can order.
    const winners = Array.from({ length: 3 }, () => Keypair.random().publicKey());
    const zeros = Array.from({ length: 30 }, () => Keypair.random().publicKey());
    const seedEvents = [
      ...winners.flatMap((t, i) => [
        {
          eventId: `wo${i}`,
          topic: 'position_opened',
          ledger: i + 1,
          payload: { positionId: i + 1, trader: t, asset: 'BTC', direction: 0, size: '100', entryPrice: '1' },
        },
        {
          eventId: `wc${i}`,
          topic: 'position_closed',
          ledger: 100 + i,
          payload: { positionId: i + 1, trader: t, pnl: String((i + 1) * 100), closePrice: '2' },
        },
      ]),
      ...zeros.map((t, i) => ({
        eventId: `z${i}`,
        topic: 'position_opened',
        ledger: 200 + i,
        payload: { positionId: 100 + i, trader: t, asset: 'BTC', direction: 0, size: '50', entryPrice: '1' },
      })),
    ];
    const setup = await setupTestServer({ seedEvents });
    app = setup.app;

    const page1 = (await app.inject({ method: 'GET', url: '/v1/leaderboard?sort=pnl&limit=20&offset=0' }))
      .json() as PageBody;
    const page2 = (await app.inject({
      method: 'GET',
      url: `/v1/leaderboard?sort=pnl&limit=20&offset=20&snapshot=${page1.snapshot}`,
    })).json() as PageBody;

    expect(page1.leaders).toHaveLength(20);
    expect(page2.leaders).toHaveLength(13);
    const all = [...page1.leaders, ...page2.leaders];
    expect(all.map((l) => l.rank)).toEqual(Array.from({ length: 33 }, (_, i) => i + 1));
    const seen = new Set(all.map((l) => l.trader));
    expect(seen.size).toBe(33);
    expect(seen).toEqual(new Set([...winners, ...zeros]));
    // Inside the all tied zero group the order is trader ascending, which is
    // what makes the boundary deterministic across requests.
    const zeroGroup = all.slice(3).map((l) => l.trader);
    expect(zeroGroup).toEqual([...zeros].sort());
  });

  it('answers an evicted snapshot id with the current snapshot and snapshotChanged', async () => {
    const res = await app!.inject({
      method: 'GET',
      url: '/v1/leaderboard?limit=20&offset=0&snapshot=testnet.pnl.0.999',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PageBody;
    expect(body.snapshotChanged).toBe(true);
    expect(body.snapshot).not.toBe('testnet.pnl.0.999');
    expect(body.leaders.length).toBeGreaterThan(0);
  });

  it('a mainnet scope request on this testnet gateway is not indexed here', async () => {
    const res = await app!.inject({ method: 'GET', url: '/v1/leaderboard?scope=mainnet' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PageBody;
    expect(body.scope).toBe('mainnet');
    expect(body.network).toBe('public');
    expect(body.state).toBe('not_indexed_here');
    expect(body.total).toBe(0);
    expect(body.leaders).toEqual([]);
  });

  it('rejects an unknown scope', async () => {
    const res = await app!.inject({ method: 'GET', url: '/v1/leaderboard?scope=devnet' });
    expect(res.statusCode).toBe(400);
  });

  it('a mainnet gateway serves an empty mainnet board even over a database full of testnet rows', async () => {
    if (app) await app.close();
    const setup = await setupTestServer({
      network: 'mainnet',
      seedEvents: [
        { eventId: 'o1', topic: 'position_opened', ledger: 1, payload: { positionId: 1, trader: A, asset: 'BTC', direction: 0, size: '100', entryPrice: '1' } },
        { eventId: 'c1', topic: 'position_closed', ledger: 2, payload: { positionId: 1, trader: A, pnl: '500', closePrice: '2' } },
      ],
    });
    app = setup.app;
    // The legacy baseline is testnet history and must not leak either.
    await setup.db.execute({
      sql: `INSERT INTO leaderboard_legacy (address, trade_count, total_volume, total_pnl, liq_count, imported_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [B, 5, '900', '42', 1, Date.now()],
    });

    const res = await app.inject({ method: 'GET', url: '/v1/leaderboard?scope=mainnet' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PageBody;
    expect(body.scope).toBe('mainnet');
    expect(body.state).toBe('empty');
    expect(body.total).toBe(0);
    expect(body.leaders).toEqual([]);

    // And the testnet scope is the one this mainnet gateway does not serve.
    const other = (await app.inject({ method: 'GET', url: '/v1/leaderboard?scope=testnet' }))
      .json() as PageBody;
    expect(other.state).toBe('not_indexed_here');
    expect(other.leaders).toEqual([]);
  });
});

describe('GET /v1/leaderboard/rank', () => {
  interface RankBody {
    trader: string;
    sort: string;
    scope: string;
    state: string;
    rank: number | null;
    total: number;
    snapshot: string;
    entry: PageLeader | null;
  }

  it('returns the same rank the board pages show', async () => {
    const board = (await app!.inject({ method: 'GET', url: '/v1/leaderboard?sort=pnl&limit=20' }))
      .json() as PageBody;
    const res = await app!.inject({ method: 'GET', url: `/v1/leaderboard/rank?trader=${A}&sort=pnl` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as RankBody;
    const onBoard = board.leaders.find((l) => l.trader === A)!;
    expect(body.rank).toBe(onBoard.rank);
    expect(body.total).toBe(board.total);
    expect(body.snapshot).toBe(board.snapshot);
    expect(body.entry).toEqual(onBoard);
  });

  it('returns a null rank for a trader who is not on the board', async () => {
    const stranger = Keypair.random().publicKey();
    const res = await app!.inject({ method: 'GET', url: `/v1/leaderboard/rank?trader=${stranger}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as RankBody;
    expect(body.rank).toBeNull();
    expect(body.entry).toBeNull();
    expect(body.total).toBe(3);
  });

  it('rejects a malformed trader address', async () => {
    const res = await app!.inject({ method: 'GET', url: '/v1/leaderboard/rank?trader=notawallet' });
    expect(res.statusCode).toBe(400);
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

  it('equals the sum over every page of the paginated board', async () => {
    if (app) await app.close();
    const N = 26;
    const traders = Array.from({ length: N }, () => Keypair.random().publicKey());
    const seedEvents = traders.map((t, i) => ({
      eventId: `o${i}`,
      topic: 'position_opened',
      ledger: i + 1,
      payload: { positionId: i + 1, trader: t, asset: 'BTC', direction: 0, size: String((i + 1) * 7), entryPrice: '1' },
    }));
    const setup = await setupTestServer({ seedEvents });
    app = setup.app;
    // One legacy only trader too, so the invariant covers the merged board.
    await setup.db.execute({
      sql: `INSERT INTO leaderboard_legacy (address, trade_count, total_volume, total_pnl, liq_count, imported_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [Keypair.random().publicKey(), 4, '800', '13', 0, Date.now()],
    });

    const seen = new Set<string>();
    let volume = 0n;
    let trades = 0;
    let offset = 0;
    let snapshot = '';
    for (;;) {
      const url = `/v1/leaderboard?sort=volume&limit=10&offset=${offset}${snapshot ? `&snapshot=${snapshot}` : ''}`;
      const body = (await app.inject({ method: 'GET', url })).json() as PageBody;
      snapshot = body.snapshot;
      for (const l of body.leaders) {
        seen.add(l.trader);
        volume += BigInt(l.volume);
        trades += l.trades;
      }
      offset += 10;
      if (offset >= body.total) break;
    }

    const totals = (await app.inject({ method: 'GET', url: '/v1/leaderboard/totals' })).json() as Totals;
    expect(totals.traders).toBe(seen.size);
    expect(totals.traders).toBe(N + 1);
    expect(BigInt(totals.volume)).toBe(volume);
    expect(totals.trades).toBe(trades);
  });
});
