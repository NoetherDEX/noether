import { describe, expect, it, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { setupTestServer } from './helpers.js';

let app: Awaited<ReturnType<typeof setupTestServer>>['app'] | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

const DAY = 86_400;
const now = Math.floor(Date.now() / 1000);

function opened(positionId: number, trader: string, asset: string, size: string) {
  return {
    topic: 'position_opened',
    positionId,
    trader,
    asset,
    direction: 0,
    size,
    entryPrice: '600000000000',
  };
}

function closed(positionId: number, trader: string, pnl = '42') {
  return { topic: 'position_closed', positionId, trader, pnl, closePrice: '610000000000' };
}

function liquidated(positionId: number, trader: string) {
  return {
    topic: 'position_liquidated',
    positionId,
    trader,
    keeperReward: '1000',
    closePrice: '590000000000',
  };
}

describe('GET /v1/account/volume', () => {
  it('sums opens and closes inside the 14-day window and ignores everything else', async () => {
    const trader = Keypair.random().publicKey();
    const other = Keypair.random().publicKey();
    const setup = await setupTestServer({
      seedEvents: [
        // opens inside the window → counted
        { eventId: 'e1', topic: 'position_opened', ledger: 100, ledgerCloseTs: now - DAY, payload: opened(1, trader, 'BTC', '10000000000') },
        { eventId: 'e2', topic: 'position_opened', ledger: 101, ledgerCloseTs: now - 13 * DAY, payload: opened(2, trader, 'ETH', '5000000000') },
        // open outside the window → open leg not counted...
        { eventId: 'e3', topic: 'position_opened', ledger: 50, ledgerCloseTs: now - 15 * DAY, payload: opened(3, trader, 'BTC', '7770000000') },
        // ...but its close lands inside the window → close leg counted
        { eventId: 'e4', topic: 'position_closed', ledger: 102, ledgerCloseTs: now - 2 * DAY, payload: closed(3, trader) },
        // liquidations record no volume in the contract → excluded
        { eventId: 'e5', topic: 'position_opened', ledger: 40, ledgerCloseTs: now - 20 * DAY, payload: opened(4, trader, 'BTC', '999000000') },
        { eventId: 'e6', topic: 'position_liquidated', ledger: 103, ledgerCloseTs: now - DAY, payload: liquidated(4, trader) },
        // another wallet's open inside the window → not this trader's volume
        { eventId: 'e7', topic: 'position_opened', ledger: 104, ledgerCloseTs: now - DAY, payload: opened(5, other, 'BTC', '123450000000') },
        // open + close both outside the window → nothing counted
        { eventId: 'e8', topic: 'position_opened', ledger: 30, ledgerCloseTs: now - 20 * DAY, payload: opened(6, trader, 'XLM', '400000000') },
        { eventId: 'e9', topic: 'position_closed', ledger: 31, ledgerCloseTs: now - 15 * DAY, payload: closed(6, trader) },
      ],
    });
    app = setup.app;

    const res = await app.inject({ method: 'GET', url: `/v1/account/volume?address=${trader}` });
    expect(res.statusCode).toBe(200);
    // 10000000000 (e1) + 5000000000 (e2) + 7770000000 (close of position 3)
    expect(res.json()).toEqual({ address: trader, volume14d: '22770000000' });
  });

  it('returns 0 for a wallet with no trades', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const address = Keypair.random().publicKey();
    const res = await app.inject({ method: 'GET', url: `/v1/account/volume?address=${address}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ address, volume14d: '0' });
  });

  it('rejects a malformed address', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/account/volume?address=GSHORT' });
    expect(res.statusCode).toBe(400);
  });

  it('requires the address parameter', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/account/volume' });
    expect(res.statusCode).toBe(400);
  });
});
