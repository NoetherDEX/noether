import { describe, expect, it } from 'vitest';
import { makeClient } from './helpers.js';

describe('vaults sub-client', () => {
  it('list() forwards leader + limit', async () => {
    const { client, fake } = makeClient({
      scripts: [{ status: 200, body: { vaults: [] } }],
    });
    await client.vaults.list({ leader: 'GABC', limit: 10 });
    const url = new URL(fake.calls[0]!.url);
    expect(url.pathname).toBe('/v1/vaults');
    expect(url.searchParams.get('leader')).toBe('GABC');
    expect(url.searchParams.get('limit')).toBe('10');
  });

  it('get(id) returns the vault row', async () => {
    const { client, fake } = makeClient({
      scripts: [
        {
          status: 200,
          body: {
            id: 7,
            leader: 'GLEAD',
            name: 'alpha',
            createdAt: 1,
            totalUsdc: '1000',
            circulatingShares: '1000',
            hwmNav: '10000000',
            realizedPnl: '0',
            leaderShares: '500',
            profitShareBps: 1000,
            paused: false,
            updatedAt: 2,
          },
        },
      ],
    });
    const row = await client.vaults.get(7);
    expect(row.id).toBe(7);
    expect(row.leader).toBe('GLEAD');
    expect(row.totalUsdc).toBe('1000');
    expect(fake.calls[0]!.url).toBe('http://api.test/v1/vaults/7');
  });

  it('trades(id) hits the trades path and unwraps rows', async () => {
    const { client, fake } = makeClient({
      scripts: [
        {
          status: 200,
          body: {
            trades: [
              {
                id: 1,
                vaultId: 3,
                positionId: '9',
                action: 'close',
                leader: 'GLEAD',
                collateral: '100000000',
                pnl: '5000000',
                ledger: 10,
                ts: 100,
                txHash: 'abc',
              },
            ],
          },
        },
      ],
    });
    const rows = await client.vaults.trades(3, { limit: 25 });
    const url = new URL(fake.calls[0]!.url);
    expect(url.pathname).toBe('/v1/vaults/3/trades');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(rows[0]!.action).toBe('close');
    expect(rows[0]!.pnl).toBe('5000000');
  });

  it('deposits / withdraws / feeClaims hit the right paths', async () => {
    const { client, fake } = makeClient({
      scripts: [
        { status: 200, body: { deposits: [] } },
        { status: 200, body: { withdraws: [] } },
        { status: 200, body: { feeClaims: [] } },
      ],
    });
    await client.vaults.deposits(3);
    await client.vaults.withdraws(3);
    await client.vaults.feeClaims(3);
    expect(new URL(fake.calls[0]!.url).pathname).toBe('/v1/vaults/3/deposits');
    expect(new URL(fake.calls[1]!.url).pathname).toBe('/v1/vaults/3/withdraws');
    expect(new URL(fake.calls[2]!.url).pathname).toBe('/v1/vaults/3/fee-claims');
  });
});
