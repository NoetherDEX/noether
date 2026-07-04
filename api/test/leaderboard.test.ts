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
});
