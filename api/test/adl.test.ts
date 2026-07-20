import { describe, expect, it, afterEach } from 'vitest';
import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import type { FastifyInstance } from 'fastify';
import { setupTestServer } from './helpers.js';
import {
  rankAdlQueue,
  decodePositionEntry,
  type AdlPositionState,
} from '../src/services/adlQueue.js';

const P = 10_000_000n; // 7-decimal PRECISION
const TRADER_A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const TRADER_B = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

const mk = (
  positionId: number,
  direction: number,
  size: bigint,
  entry: bigint,
  collateral: bigint,
  leverage: number,
  trader = TRADER_A,
): AdlPositionState => ({ positionId, trader, direction, collateral, size, entryPrice: entry, leverage });

describe('rankAdlQueue (pure L0-1 formula)', () => {
  it('ranks only winners, highest score first, exact score values', () => {
    const mark = 11n * P; // entry 10 → +10%
    const rows = rankAdlQueue(
      [
        // pnl = 1000×(11−10)/10 = 100; score = (100×10_000/100)×10 = 100_000
        mk(1, 0, 1000n * P, 10n * P, 100n * P, 10),
        // pnl = 200×(11−10)/10 = 20; score = (20×10_000/100)×2 = 4_000
        mk(2, 0, 200n * P, 10n * P, 100n * P, 2),
        // short loser at a rising mark — never queues
        mk(3, 1, 500n * P, 10n * P, 50n * P, 10),
      ],
      mark,
      'BTC',
    );
    expect(rows.map((r) => r.positionId)).toEqual([1, 2]);
    expect(rows[0].score).toBe((100n * P * 10_000n / (100n * P) * 10n).toString());
    expect(rows[0].rank).toBe(1);
  });

  it('assigns quintiles 1..5 across five winners and breaks score ties by lower id', () => {
    const mark = 11n * P;
    const winners = [5, 4, 3, 2, 1].map((id) =>
      mk(id, 0, 100n * P, 10n * P, 100n * P, id), // score scales with leverage=id
    );
    const rows = rankAdlQueue(winners, mark, 'ETH');
    expect(rows.map((r) => r.quintile)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.map((r) => r.positionId)).toEqual([5, 4, 3, 2, 1]);

    const tie = rankAdlQueue(
      [mk(9, 0, 100n * P, 10n * P, 100n * P, 5), mk(4, 0, 100n * P, 10n * P, 100n * P, 5)],
      mark,
      'ETH',
    );
    expect(tie.map((r) => r.positionId)).toEqual([4, 9]);
  });
});

describe('decodePositionEntry', () => {
  it('decodes a Position contract-data entry incl. the unit-enum direction', () => {
    // Struct map entries MUST be key-sorted for UDT decode — mirror that here.
    const entry = (key: string, val: xdr.ScVal) =>
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
    const positionVal = xdr.ScVal.scvMap([
      entry('asset', xdr.ScVal.scvSymbol('BTC')),
      entry('collateral', nativeToScVal(100n * P, { type: 'i128' })),
      entry('direction', xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Short')])),
      entry('entry_cumulative_funding', nativeToScVal(0n, { type: 'i128' })),
      entry('entry_price', nativeToScVal(10n * P, { type: 'i128' })),
      entry('id', nativeToScVal(42n, { type: 'u64' })),
      entry('leverage', nativeToScVal(7, { type: 'u32' })),
      entry('liquidation_price', nativeToScVal(11n * P, { type: 'i128' })),
      entry('margin_mode', nativeToScVal(0, { type: 'u32' })),
      entry('size', nativeToScVal(700n * P, { type: 'i128' })),
      entry('timestamp', nativeToScVal(1_700_000_000n, { type: 'u64' })),
      entry('trader', new Address(TRADER_A).toScVal()),
    ]);
    const data = xdr.LedgerEntryData.contractData(
      new xdr.ContractDataEntry({
        ext: new xdr.ExtensionPoint(0),
        contract: new Address(TRADER_A).toScAddress(),
        key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Position'), nativeToScVal(42n, { type: 'u64' })]),
        durability: xdr.ContractDataDurability.persistent(),
        val: positionVal,
      }),
    );
    const decoded = decodePositionEntry(data);
    expect(decoded).not.toBeNull();
    expect(decoded!.positionId).toBe(42);
    expect(decoded!.direction).toBe(1);
    expect(decoded!.collateral).toBe(100n * P);
    expect(decoded!.leverage).toBe(7);
  });
});

describe('ADL + shortfall routes', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const seedPositionRows = async (db: Awaited<ReturnType<typeof setupTestServer>>['db']) => {
    for (const [id, trader] of [
      [1, TRADER_A],
      [2, TRADER_B],
    ] as const) {
      await db.execute({
        sql: `INSERT INTO positions (position_id, trader, asset, direction, size, entry_price, opened_at, opened_tx_hash)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, trader, 'BTC', 0, (1000n * P).toString(), (10n * P).toString(), 1, 't'],
      });
    }
  };

  it('serves the ranked queue and filters by trader', async () => {
    const setup = await setupTestServer({
      oraclePrices: { BTC: [11n * P, 1_700_000_000n] },
      adlPositions: [
        mk(1, 0, 1000n * P, 10n * P, 100n * P, 10, TRADER_A), // winner
        mk(2, 1, 1000n * P, 10n * P, 100n * P, 10, TRADER_B), // loser at this mark
      ],
    });
    app = setup.app;
    await seedPositionRows(setup.db);

    const res = await app.inject({ method: 'GET', url: '/v1/adl/queue?asset=btc' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { degraded: boolean; rows: Array<{ positionId: number; quintile: number }> };
    expect(body.degraded).toBe(false);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].positionId).toBe(1);
    expect(body.rows[0].quintile).toBe(1);

    const filtered = await app.inject({
      method: 'GET',
      url: `/v1/adl/queue?asset=BTC&trader=${TRADER_B}`,
    });
    expect((filtered.json() as { rows: unknown[] }).rows).toHaveLength(0);
  });

  it('merges adlQuintile into /v1/positions/open rows (null when not queued)', async () => {
    const setup = await setupTestServer({
      oraclePrices: { BTC: [11n * P, 1_700_000_000n] },
      adlPositions: [
        mk(1, 0, 1000n * P, 10n * P, 100n * P, 10, TRADER_A),
        mk(2, 1, 1000n * P, 10n * P, 100n * P, 10, TRADER_B),
      ],
    });
    app = setup.app;
    await seedPositionRows(setup.db);

    const res = await app.inject({ method: 'GET', url: '/v1/positions/open' });
    const rows = (res.json() as { positions: Array<{ positionId: number; adlQuintile: number | null }> }).positions;
    const byId = new Map(rows.map((r) => [r.positionId, r.adlQuintile]));
    expect(byId.get(1)).toBe(1);
    expect(byId.get(2)).toBeNull();
  });

  it('serves shortfall when the vault views exist and supported:false when they do not', async () => {
    const withViews = await setupTestServer({ shortfall: { owed: 123n, reserve: 456n } });
    app = withViews.app;
    const ok = await app.inject({
      method: 'GET',
      url: `/v1/account/shortfall?address=${TRADER_A}`,
    });
    expect(ok.json()).toEqual({ address: TRADER_A, owed: '123', reserve: '456', supported: true });
    await app.close();

    const without = await setupTestServer({});
    app = without.app;
    const missing = await app.inject({
      method: 'GET',
      url: `/v1/account/shortfall?address=${TRADER_A}`,
    });
    expect(missing.json()).toEqual({ address: TRADER_A, owed: '0', reserve: '0', supported: false });
  });
});
