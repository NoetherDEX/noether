import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { setupTestServer } from './helpers.js';

let app: Awaited<ReturnType<typeof setupTestServer>>['app'] | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

const traderA = Keypair.random().publicKey();
const traderB = Keypair.random().publicKey();

interface TradeRow {
  positionId: number;
  trader: string;
  kind: string;
  asset: string | null;
  direction: number | null;
  size: string | null;
  entryPrice: string | null;
  closePrice: string | null;
  pnl: string | null;
  ledger: number;
  ts: number;
  txHash: string;
}

beforeEach(async () => {
  const setup = await setupTestServer({
    seedEvents: [
      { eventId: 't1', topic: 'position_opened', ledger: 100, payload: { topic: 'position_opened', positionId: 1, trader: traderA, asset: 'BTC', direction: 0, size: '10000000000', entryPrice: '600000000000' } },
      { eventId: 't2', topic: 'position_opened', ledger: 101, payload: { topic: 'position_opened', positionId: 2, trader: traderA, asset: 'ETH', direction: 1, size: '5000000000', entryPrice: '30000000000' } },
      { eventId: 't3', topic: 'position_opened', ledger: 102, payload: { topic: 'position_opened', positionId: 3, trader: traderB, asset: 'BTC', direction: 0, size: '2000000000', entryPrice: '590000000000' } },
      { eventId: 't4', topic: 'position_closed', ledger: 200, txHash: 'h1', payload: { topic: 'position_closed', positionId: 1, trader: traderA, pnl: '123', closePrice: '610000000000' } },
      { eventId: 't5', topic: 'position_liquidated', ledger: 201, txHash: 'h2', payload: { topic: 'position_liquidated', positionId: 2, trader: traderA, keeperReward: '77', closePrice: '29000000000' } },
      { eventId: 't6', topic: 'position_closed', ledger: 202, txHash: 'h3', payload: { topic: 'position_closed', positionId: 3, trader: traderB, pnl: '-9', closePrice: '580000000000' } },
      // realized event whose open predates indexer history → null enrichment
      { eventId: 't7', topic: 'position_closed', ledger: 203, txHash: 'h4', payload: { topic: 'position_closed', positionId: 99, trader: traderB, pnl: '1', closePrice: '1000000000' } },
    ],
  });
  app = setup.app;
});

describe('GET /v1/trades', () => {
  it('lists realized trades newest first with fields joined from the open event', async () => {
    const res = await app!.inject({ method: 'GET', url: '/v1/trades' });
    expect(res.statusCode).toBe(200);
    const { trades } = res.json() as { trades: TradeRow[] };
    expect(trades.map((t) => t.positionId)).toEqual([99, 3, 2, 1]);

    const closeRow = trades.find((t) => t.positionId === 1)!;
    expect(closeRow.kind).toBe('close');
    expect(closeRow.trader).toBe(traderA);
    expect(closeRow.asset).toBe('BTC');
    expect(closeRow.direction).toBe(0);
    expect(closeRow.size).toBe('10000000000');
    expect(closeRow.entryPrice).toBe('600000000000');
    expect(closeRow.closePrice).toBe('610000000000');
    expect(closeRow.pnl).toBe('123');
    expect(closeRow.txHash).toBe('h1');
    expect(closeRow.ledger).toBe(200);

    const liqRow = trades.find((t) => t.positionId === 2)!;
    expect(liqRow.kind).toBe('liquidation');
    expect(liqRow.asset).toBe('ETH');
    expect(liqRow.size).toBe('5000000000');
    expect(liqRow.pnl).toBeNull();

    const orphan = trades.find((t) => t.positionId === 99)!;
    expect(orphan.asset).toBeNull();
    expect(orphan.size).toBeNull();
    expect(orphan.entryPrice).toBeNull();
    expect(orphan.pnl).toBe('1');
  });

  it('filters by trader', async () => {
    const res = await app!.inject({ method: 'GET', url: `/v1/trades?trader=${traderA}` });
    expect(res.statusCode).toBe(200);
    const { trades } = res.json() as { trades: TradeRow[] };
    expect(trades.map((t) => t.positionId)).toEqual([2, 1]);
    expect(trades.every((t) => t.trader === traderA)).toBe(true);
  });

  it('filters by asset (case-insensitive) and drops rows without a known open', async () => {
    const res = await app!.inject({ method: 'GET', url: '/v1/trades?asset=btc' });
    expect(res.statusCode).toBe(200);
    const { trades } = res.json() as { trades: TradeRow[] };
    expect(trades.map((t) => t.positionId)).toEqual([3, 1]);
  });

  it('honours the limit parameter', async () => {
    const res = await app!.inject({ method: 'GET', url: '/v1/trades?limit=1' });
    expect(res.statusCode).toBe(200);
    const { trades } = res.json() as { trades: TradeRow[] };
    expect(trades).toHaveLength(1);
    expect(trades[0]!.positionId).toBe(99);
  });

  it('rejects an out-of-range limit', async () => {
    const res = await app!.inject({ method: 'GET', url: '/v1/trades?limit=9999' });
    expect(res.statusCode).toBe(400);
  });
});
