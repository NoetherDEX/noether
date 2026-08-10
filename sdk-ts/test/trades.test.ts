import { describe, expect, it } from 'vitest';
import { makeClient } from './helpers.js';

const CLOSE_ROW = {
  positionId: 7,
  trader: 'GABC',
  kind: 'close',
  asset: 'BTC',
  direction: 0,
  size: '1000000000',
  entryPrice: '600000000000',
  closePrice: '610000000000',
  pnl: '16666666',
  ledger: 100,
  ts: 1_784_000_000,
  txHash: 'cafe',
};

describe('trades sub client', () => {
  it('list() unwraps trades and forwards every filter', async () => {
    const { client, fake } = makeClient({
      scripts: [{ status: 200, body: { trades: [CLOSE_ROW] } }],
    });
    const rows = await client.trades.list({
      trader: 'GABC',
      asset: 'btc',
      beforeTs: 1_785_000_000,
      limit: 25,
      includeOpens: true,
    });
    const url = new URL(fake.calls[0]!.url);
    expect(url.pathname).toBe('/v1/trades');
    expect(url.searchParams.get('trader')).toBe('GABC');
    expect(url.searchParams.get('asset')).toBe('BTC');
    expect(url.searchParams.get('before_ts')).toBe('1785000000');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('include_opens')).toBe('true');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('close');
    expect(rows[0]!.pnl).toBe('16666666');
  });

  it('list() with no filters sends no query params', async () => {
    const { client, fake } = makeClient({
      scripts: [{ status: 200, body: { trades: [] } }],
    });
    await client.trades.list();
    const url = new URL(fake.calls[0]!.url);
    expect([...url.searchParams.keys()]).toEqual([]);
  });

  it('list() carries cross_liquidation rows with null position fields', async () => {
    const { client } = makeClient({
      scripts: [
        {
          status: 200,
          body: {
            trades: [
              {
                positionId: null,
                trader: 'GDEF',
                kind: 'cross_liquidation',
                asset: null,
                direction: null,
                size: null,
                entryPrice: null,
                closePrice: null,
                pnl: '-5000000',
                ledger: 101,
                ts: 1_784_000_100,
                txHash: 'beef',
              },
            ],
          },
        },
      ],
    });
    const rows = await client.trades.list();
    expect(rows[0]!.positionId).toBeNull();
    expect(rows[0]!.kind).toBe('cross_liquidation');
    expect(rows[0]!.pnl).toBe('-5000000');
  });
});
