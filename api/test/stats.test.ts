import { describe, expect, it, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { FAKE_CONTRACT, setupTestServer } from './helpers.js';
import { SUPPORTED_ASSET_SYMBOLS } from '@noether/shared';

let app: Awaited<ReturnType<typeof setupTestServer>>['app'] | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

const DAY = 86_400;
const now = Math.floor(Date.now() / 1000);

interface AssetStats {
  asset: string;
  openInterestLong: string;
  openInterestShort: string;
  openInterestNet: string;
  openPositions: number;
  volume24h: string;
}

async function seedPosition(
  db: Awaited<ReturnType<typeof setupTestServer>>['db'],
  id: number,
  trader: string,
  asset: string,
  direction: number,
  size: string,
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO positions (position_id, trader, asset, direction, size, entry_price, opened_at, opened_tx_hash, contract_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, trader, asset, direction, size, '600000000000', now, 'tx', FAKE_CONTRACT],
  });
}

describe('GET /v1/markets/stats', () => {
  it('aggregates per-asset open interest and 24h volume', async () => {
    const tA = Keypair.random().publicKey();
    const tB = Keypair.random().publicKey();
    const setup = await setupTestServer({
      seedEvents: [
        // open inside 24h → counts toward BTC volume
        { eventId: 's1', topic: 'position_opened', ledger: 100, ledgerCloseTs: now - 3600, payload: { topic: 'position_opened', positionId: 21, trader: tA, asset: 'BTC', direction: 0, size: '2000000000', entryPrice: '600000000000' } },
        // open outside 24h → open leg ignored
        { eventId: 's2', topic: 'position_opened', ledger: 90, ledgerCloseTs: now - 2 * DAY, payload: { topic: 'position_opened', positionId: 22, trader: tA, asset: 'BTC', direction: 0, size: '9990000000', entryPrice: '600000000000' } },
        // ...but its close inside 24h counts the realized notional
        { eventId: 's3', topic: 'position_closed', ledger: 101, ledgerCloseTs: now - 1800, payload: { topic: 'position_closed', positionId: 22, trader: tA, pnl: '5', closePrice: '610000000000' } },
        // liquidations count toward market volume too
        { eventId: 's4', topic: 'position_opened', ledger: 80, ledgerCloseTs: now - 3 * DAY, payload: { topic: 'position_opened', positionId: 23, trader: tB, asset: 'ETH', direction: 1, size: '500000000', entryPrice: '30000000000' } },
        { eventId: 's5', topic: 'position_liquidated', ledger: 102, ledgerCloseTs: now - 100, payload: { topic: 'position_liquidated', positionId: 23, trader: tB, keeperReward: '9', closePrice: '29000000000' } },
      ],
    });
    app = setup.app;

    await seedPosition(setup.db, 11, tA, 'BTC', 0, '10000000000');
    await seedPosition(setup.db, 12, tA, 'BTC', 0, '5000000000');
    await seedPosition(setup.db, 13, tB, 'BTC', 1, '3000000000');
    await seedPosition(setup.db, 14, tB, 'ETH', 1, '7000000000');

    const res = await app.inject({ method: 'GET', url: '/v1/markets/stats' });
    expect(res.statusCode).toBe(200);
    const { stats } = res.json() as { stats: AssetStats[] };

    const btc = stats.find((s) => s.asset === 'BTC')!;
    expect(btc.openInterestLong).toBe('15000000000');
    expect(btc.openInterestShort).toBe('3000000000');
    expect(btc.openInterestNet).toBe('12000000000');
    expect(btc.openPositions).toBe(3);
    // 2000000000 (open s1) + 9990000000 (close s3 of position 22)
    expect(btc.volume24h).toBe('11990000000');

    const eth = stats.find((s) => s.asset === 'ETH')!;
    expect(eth.openInterestLong).toBe('0');
    expect(eth.openInterestShort).toBe('7000000000');
    expect(eth.openInterestNet).toBe('-7000000000');
    expect(eth.openPositions).toBe(1);
    // liquidation of position 23 realizes its 500000000 notional
    expect(eth.volume24h).toBe('500000000');

    const xlm = stats.find((s) => s.asset === 'XLM')!;
    expect(xlm.openInterestLong).toBe('0');
    expect(xlm.openInterestShort).toBe('0');
    expect(xlm.openInterestNet).toBe('0');
    expect(xlm.openPositions).toBe(0);
    expect(xlm.volume24h).toBe('0');
  });

  it('returns zeroed stats for all supported assets on an empty database', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/markets/stats' });
    expect(res.statusCode).toBe(200);
    const { stats } = res.json() as { stats: AssetStats[] };
    expect(stats.map((s) => s.asset).sort()).toEqual([...SUPPORTED_ASSET_SYMBOLS].sort());
    for (const s of stats) {
      expect(s.openInterestLong).toBe('0');
      expect(s.openInterestShort).toBe('0');
      expect(s.openInterestNet).toBe('0');
      expect(s.openPositions).toBe(0);
      expect(s.volume24h).toBe('0');
    }
  });
});
