import { describe, expect, it } from 'vitest';
import { makeClient } from './helpers.js';

describe('adl sub client', () => {
  it('queue() uppercases the asset and returns the full result', async () => {
    const { client, fake } = makeClient({
      scripts: [
        {
          status: 200,
          body: {
            asset: 'BTC',
            updatedAt: 1_784_000_000_000,
            degraded: false,
            rows: [
              {
                positionId: 3,
                trader: 'GABC',
                asset: 'BTC',
                direction: 0,
                size: '1000000000',
                pnl: '50000000',
                score: '25000',
                rank: 1,
                quintile: 1,
              },
            ],
          },
        },
      ],
    });
    const res = await client.adl.queue('btc');
    const url = new URL(fake.calls[0]!.url);
    expect(url.pathname).toBe('/v1/adl/queue');
    expect(url.searchParams.get('asset')).toBe('BTC');
    expect(url.searchParams.has('trader')).toBe(false);
    expect(res.degraded).toBe(false);
    expect(res.rows[0]!.quintile).toBe(1);
    expect(res.rows[0]!.score).toBe('25000');
  });

  it('queue() forwards the trader filter and surfaces degraded', async () => {
    const { client, fake } = makeClient({
      scripts: [
        { status: 200, body: { asset: 'ETH', updatedAt: 1, degraded: true, rows: [] } },
      ],
    });
    const res = await client.adl.queue('ETH', { trader: 'GDEF' });
    const url = new URL(fake.calls[0]!.url);
    expect(url.searchParams.get('trader')).toBe('GDEF');
    // degraded means unknown, not that nobody is at risk.
    expect(res.degraded).toBe(true);
    expect(res.rows).toEqual([]);
  });
});
