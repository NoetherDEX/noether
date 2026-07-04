import { describe, expect, it } from 'vitest';
import { makeClient } from './helpers.js';

describe('positions sub-client', () => {
  it('open() forwards trader and unwraps positions', async () => {
    const { client, fake } = makeClient({
      scripts: [
        {
          status: 200,
          body: {
            positions: [
              {
                positionId: 12,
                trader: 'GABC',
                asset: 'BTC',
                direction: 0,
                size: '1000000000',
                entryPrice: '600000000000',
                openedAt: 100,
                openedTxHash: 'deadbeef',
              },
            ],
          },
        },
      ],
    });
    const rows = await client.positions.open({ trader: 'GABC' });
    const url = new URL(fake.calls[0]!.url);
    expect(url.pathname).toBe('/v1/positions/open');
    expect(url.searchParams.get('trader')).toBe('GABC');
    expect(rows[0]!.positionId).toBe(12);
    expect(rows[0]!.entryPrice).toBe('600000000000');
  });

  it('open() with no filter omits the trader param', async () => {
    const { client, fake } = makeClient({
      scripts: [{ status: 200, body: { positions: [] } }],
    });
    await client.positions.open();
    const url = new URL(fake.calls[0]!.url);
    expect(url.searchParams.has('trader')).toBe(false);
  });
});
