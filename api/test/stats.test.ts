import { describe, expect, it, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { FAKE_CONTRACT, setupTestServer } from './helpers.js';
import { SUPPORTED_ASSET_SYMBOLS } from '@noether/shared';
import { CUSTODY_STALE_MS } from '../src/services/keeperStatus.js';

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

describe('GET /v1/markets/stats — custody invariant (keeper self-report)', () => {
  const CUSTODY = {
    marketUsdcBalance: '2649276391892',
    trackedCustody: '2389338300000',
    isolatedCollateral: '2167102500000',
    crossPositionCollateral: '150000000000',
    crossBalances: '222235800000',
    orderEscrow: '0',
    deficit: '0',
    positions: 59,
    asOf: Date.now() - 5_000,
  };

  it('relays the keeper custody block once a heartbeat carried one, stale:false', async () => {
    const setup = await setupTestServer({ keeperHeartbeatSecret: 's3cret' });
    app = setup.app;
    const before = await app.inject({ method: 'GET', url: '/v1/markets/stats' });
    expect(before.json().custody).toBeUndefined();

    const post = await app.inject({
      method: 'POST',
      url: '/v1/oracle/heartbeat',
      headers: { 'x-keeper-secret': 's3cret' },
      payload: { ts: 1, pushed: [], custody: CUSTODY },
    });
    expect(post.statusCode).toBe(204);

    const res = await app.inject({ method: 'GET', url: '/v1/markets/stats' });
    expect(res.statusCode).toBe(200);
    expect(res.json().custody).toEqual({ ...CUSTODY, ageMs: expect.any(Number), stale: false });
  });

  it('measures staleness from the report asOf, not the heartbeat that relayed it', async () => {
    const setup = await setupTestServer({ keeperHeartbeatSecret: 's3cret' });
    app = setup.app;
    // A keeper whose custody check is failing keeps re-posting its LAST
    // report on every live heartbeat; the data is old even though the
    // heartbeat is seconds old.
    const asOf = Date.now() - 6 * 60_000;
    await app.inject({
      method: 'POST',
      url: '/v1/oracle/heartbeat',
      headers: { 'x-keeper-secret': 's3cret' },
      payload: { ts: Date.now(), pushed: ['BTC'], custody: { ...CUSTODY, asOf } },
    });
    const custody = (await app.inject({ method: 'GET', url: '/v1/markets/stats' })).json().custody;
    expect(custody.stale).toBe(true);
    expect(custody.ageMs).toBeGreaterThanOrEqual(6 * 60_000);
  });

  it('never trusts an asOf ahead of the heartbeat that delivered it', async () => {
    const setup = await setupTestServer({ keeperHeartbeatSecret: 's3cret' });
    app = setup.app;
    await app.inject({
      method: 'POST',
      url: '/v1/oracle/heartbeat',
      headers: { 'x-keeper-secret': 's3cret' },
      payload: { ts: Date.now(), pushed: [], custody: { ...CUSTODY, asOf: Date.now() + 60 * 60_000 } },
    });
    const custody = (await app.inject({ method: 'GET', url: '/v1/markets/stats' })).json().custody;
    // Anchored on arrival, so the age is real (small, non-negative) rather
    // than pinned at 0 by a clock an hour ahead.
    expect(custody.stale).toBe(false);
    expect(custody.ageMs).toBeGreaterThanOrEqual(0);
    expect(custody.ageMs).toBeLessThan(CUSTODY_STALE_MS);
  });

  it('omits the block (never zero-fills) when the report is malformed or absent', async () => {
    const setup = await setupTestServer({ keeperHeartbeatSecret: 's3cret' });
    app = setup.app;
    // A keeper build without the custody duty: heartbeat, no block.
    await app.inject({
      method: 'POST',
      url: '/v1/oracle/heartbeat',
      headers: { 'x-keeper-secret': 's3cret' },
      payload: { ts: 1, pushed: [] },
    });
    expect((await app.inject({ method: 'GET', url: '/v1/markets/stats' })).json().custody).toBeUndefined();
    // Malformed amounts are rejected wholesale rather than defaulted to "0".
    await app.inject({
      method: 'POST',
      url: '/v1/oracle/heartbeat',
      headers: { 'x-keeper-secret': 's3cret' },
      payload: { ts: 2, pushed: [], custody: { ...CUSTODY, deficit: 'n/a' } },
    });
    expect((await app.inject({ method: 'GET', url: '/v1/markets/stats' })).json().custody).toBeUndefined();
  });
});

describe('GET /v1/markets/stats — L1-13 capacity headroom', () => {
  // The prod vault + XLM book on 2026-08-24, pre-deposit: the numbers behind
  // the #89 the friend hit. Same fixture as packages/shared/test/capacity.test.ts.
  const PROD_2026_08_24 = {
    aum: 14_436_001_453_851n,
    reservedPayout: 8_961_594_157_885n,
    usdcBalance: 14_747_198_788_346n,
    shortfallReserve: 0n,
    reserveCapBps: 7_000,
    maxPositionSize: 1_000_000_000_000n,
    exposure: { XLM: { long: 252_541_116_930n, short: 1_614_090_000_000n } },
    latestLedger: 4_314_754,
  };

  it('folds per-asset capacity and the pool block in when the chain reads succeed', async () => {
    const setup = await setupTestServer({ capacity: PROD_2026_08_24 });
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/markets/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.pool).toEqual({
      aum: '14436001453851',
      reservedPayout: '8961594157885',
      usdcBalance: '14747198788346',
      shortfallReserve: '0',
      reserveCapBps: 7000,
      reserveCap: '10105201017695',
      aggregateHeadroom: '1143606859810',
      aggregateBinding: 'aggregate',
      asOfLedger: 4314754,
      ts: expect.any(Number),
      stale: false,
    });

    const xlm = body.stats.find((s: AssetStats) => s.asset === 'XLM');
    expect(xlm.capacity).toEqual({
      headroomLong: '1000000000000',
      headroomShort: '803851335007',
      bindingLong: 'maxPosition',
      bindingShort: 'skew',
      oiLong: '252541116930',
      oiShort: '1614090000000',
      netSkew: '-1361548883070',
      sideCap: '3609000363462',
      skewCap: '2165400218077',
      assetCapBps: 2500,
      capAbs: '0',
      skewCapBps: 1500,
      maxPositionSize: '1000000000000',
    });
    // The projection columns are untouched by the chain block.
    expect(xlm.openInterestLong).toBe('0');

    // An asset nobody traded has no AssetExposure entry — that is a flat book, not an error.
    const btc = body.stats.find((s: AssetStats) => s.asset === 'BTC');
    expect(btc.capacity.oiLong).toBe('0');
    expect(btc.capacity.oiShort).toBe('0');
    expect(btc.capacity.bindingLong).toBe('maxPosition');
    expect(btc.capacity.headroomLong).toBe('1000000000000');
  });

  it('reports the per-side OI cap and an unset max position size honestly', async () => {
    const setup = await setupTestServer({
      capacity: {
        ...PROD_2026_08_24,
        maxPositionSize: null,
        assetCaps: { XLM: [2500, 2_000_000_000_000n, 1500] }, // $200k absolute cap
      },
    });
    app = setup.app;
    const body = (await app.inject({ method: 'GET', url: '/v1/markets/stats' })).json();
    const xlm = body.stats.find((s: AssetStats) => s.asset === 'XLM');
    expect(xlm.capacity.maxPositionSize).toBeNull();
    expect(xlm.capacity.sideCap).toBe('2000000000000');
    expect(xlm.capacity.capAbs).toBe('2000000000000');
    // short: side room 200k − 161.4k = 38.6k binds below the 80.4k skew room.
    expect(xlm.capacity.headroomShort).toBe('385910000000');
    expect(xlm.capacity.bindingShort).toBe('side');
  });

  it('omits capacity and pool — never zeros — when the chain reads fail', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/markets/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pool).toBeUndefined();
    expect(body.stats).toHaveLength(SUPPORTED_ASSET_SYMBOLS.length);
    for (const row of body.stats as AssetStats[]) {
      expect((row as { capacity?: unknown }).capacity).toBeUndefined();
    }
  });
});
