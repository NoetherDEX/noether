import { describe, expect, it, afterEach, vi } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { setupTestServer, signChallengeXdr } from './helpers.js';

let app: Awaited<ReturnType<typeof setupTestServer>>['app'] | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

async function authedKey(): Promise<{
  app: Awaited<ReturnType<typeof setupTestServer>>['app'];
  keyId: string;
  secret: string;
  address: string;
}> {
  const setup = await setupTestServer();
  app = setup.app;
  const kp = Keypair.random();
  const address = kp.publicKey();
  const ch = await app.inject({
    method: 'POST',
    url: '/v1/keys/challenge',
    payload: { address },
  });
  const { challengeHex } = ch.json() as { challengeHex: string };
  const sig = signChallengeXdr(kp, challengeHex);
  const issued = await app.inject({
    method: 'POST',
    url: '/v1/keys',
    payload: { address, challenge: challengeHex, signature: sig },
  });
  const { keyId, secret } = issued.json() as { keyId: string; secret: string };
  return { app: setup.app, keyId, secret, address };
}

describe('POST /v1/orders/prepare', () => {
  it('rejects unauthenticated requests', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/orders/prepare',
      payload: { op: 'open_position', asset: 'BTC', collateral: '1000000000', leverage: 5, direction: 'Long' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('routes open_position to the correct builder with owner as trader', async () => {
    const captured: Array<{ kind: string; args: unknown }> = [];
    const stub = (kind: string) => async (_ctx: unknown, _market: unknown, params: unknown) => {
      captured.push({ kind, args: params });
      return { xdr: `xdr-${kind}`, simulation: { minResourceFee: '1000' } as never };
    };
    const FAKE = 'CCVDWH4ZL4RNVD52CWQ2LABTLUFFF4VLTXIT5LR7AQSLIB7YOZCOFMOD';
    const setup = await setupTestServer({
      ordersOverride: {
        txCtx: { rpcUrl: 'http://stub', network: 'testnet' },
        marketContractId: FAKE,
        builders: {
          openPosition: stub('open') as never,
          closePosition: stub('close') as never,
          placeLimitOrder: stub('limit') as never,
          cancelOrder: stub('cancel') as never,
        },
      },
    });
    app = setup.app;

    const kp = Keypair.random();
    const address = kp.publicKey();
    const ch = await app.inject({ method: 'POST', url: '/v1/keys/challenge', payload: { address } });
    const sig = signChallengeXdr(kp, (ch.json() as { challengeHex: string }).challengeHex);
    const issued = await app.inject({
      method: 'POST',
      url: '/v1/keys',
      payload: { address, challenge: (ch.json() as { challengeHex: string }).challengeHex, signature: sig },
    });
    const { keyId, secret } = issued.json() as { keyId: string; secret: string };

    const res = await app.inject({
      method: 'POST',
      url: '/v1/orders/prepare',
      headers: { authorization: `Bearer ${keyId}:${secret}` },
      payload: { op: 'open_position', asset: 'BTC', collateral: '1000000000', leverage: 5, direction: 'Long' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { op: string; trader: string; xdr: string };
    expect(body.op).toBe('open_position');
    expect(body.trader).toBe(address);
    expect(body.xdr).toBe('xdr-open');
    expect(captured).toHaveLength(1);
    expect((captured[0]!.args as { trader: string }).trader).toBe(address);
    expect((captured[0]!.args as { collateral: bigint }).collateral).toBe(1_000_000_000n);
  });

  it('rejects unsupported asset', async () => {
    const { app: a, keyId, secret } = await authedKey();
    app = a;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/orders/prepare',
      headers: { authorization: `Bearer ${keyId}:${secret}` },
      payload: { op: 'open_position', asset: 'PEPE', collateral: '100', leverage: 5, direction: 'Long' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toBe('unsupported_asset');
  });

  it('rejects leverage out of range via schema validation', async () => {
    const { app: a, keyId, secret } = await authedKey();
    app = a;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/orders/prepare',
      headers: { authorization: `Bearer ${keyId}:${secret}` },
      payload: { op: 'open_position', asset: 'BTC', collateral: '100', leverage: 99, direction: 'Long' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects collateral that is not a digit string', async () => {
    const { app: a, keyId, secret } = await authedKey();
    app = a;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/orders/prepare',
      headers: { authorization: `Bearer ${keyId}:${secret}` },
      payload: { op: 'open_position', asset: 'BTC', collateral: '-1', leverage: 5, direction: 'Long' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('routes place_limit_order with all params to builder', async () => {
    const captured: { args?: unknown } = {};
    const FAKE = 'CCVDWH4ZL4RNVD52CWQ2LABTLUFFF4VLTXIT5LR7AQSLIB7YOZCOFMOD';
    const setup = await setupTestServer({
      ordersOverride: {
        txCtx: { rpcUrl: 'http://stub', network: 'testnet' },
        marketContractId: FAKE,
        builders: {
          openPosition: vi.fn() as never,
          closePosition: vi.fn() as never,
          placeLimitOrder: (async (_c: unknown, _m: unknown, p: unknown) => {
            captured.args = p;
            return { xdr: 'xdr-limit', simulation: { minResourceFee: '1000' } as never };
          }) as never,
          cancelOrder: vi.fn() as never,
        },
      },
    });
    app = setup.app;
    const kp = Keypair.random();
    const address = kp.publicKey();
    const ch = await app.inject({ method: 'POST', url: '/v1/keys/challenge', payload: { address } });
    const sig = signChallengeXdr(kp, (ch.json() as { challengeHex: string }).challengeHex);
    const issued = await app.inject({
      method: 'POST',
      url: '/v1/keys',
      payload: { address, challenge: (ch.json() as { challengeHex: string }).challengeHex, signature: sig },
    });
    const { keyId, secret } = issued.json() as { keyId: string; secret: string };

    const res = await app.inject({
      method: 'POST',
      url: '/v1/orders/prepare',
      headers: { authorization: `Bearer ${keyId}:${secret}` },
      payload: {
        op: 'place_limit_order',
        asset: 'ETH',
        direction: 'Short',
        collateral: '500000000',
        leverage: 3,
        triggerPrice: '30000000000',
        triggerCondition: 'Below',
        slippageToleranceBps: 100,
      },
    });
    expect(res.statusCode).toBe(200);
    const args = captured.args as { triggerPrice: bigint; triggerCondition: string; slippageToleranceBps: number };
    expect(args.triggerPrice).toBe(30_000_000_000n);
    expect(args.triggerCondition).toBe('Below');
    expect(args.slippageToleranceBps).toBe(100);
  });

  it('cancel_order routes correctly', async () => {
    const seen: bigint[] = [];
    const FAKE = 'CCVDWH4ZL4RNVD52CWQ2LABTLUFFF4VLTXIT5LR7AQSLIB7YOZCOFMOD';
    const setup = await setupTestServer({
      ordersOverride: {
        txCtx: { rpcUrl: 'http://stub', network: 'testnet' },
        marketContractId: FAKE,
        builders: {
          openPosition: vi.fn() as never,
          closePosition: vi.fn() as never,
          placeLimitOrder: vi.fn() as never,
          cancelOrder: (async (_c: unknown, _m: unknown, p: { orderId: bigint }) => {
            seen.push(p.orderId);
            return { xdr: 'xdr-cancel', simulation: { minResourceFee: '1000' } as never };
          }) as never,
        },
      },
    });
    app = setup.app;
    const kp = Keypair.random();
    const address = kp.publicKey();
    const ch = await app.inject({ method: 'POST', url: '/v1/keys/challenge', payload: { address } });
    const sig = signChallengeXdr(kp, (ch.json() as { challengeHex: string }).challengeHex);
    const issued = await app.inject({
      method: 'POST',
      url: '/v1/keys',
      payload: { address, challenge: (ch.json() as { challengeHex: string }).challengeHex, signature: sig },
    });
    const { keyId, secret } = issued.json() as { keyId: string; secret: string };

    const res = await app.inject({
      method: 'POST',
      url: '/v1/orders/prepare',
      headers: { authorization: `Bearer ${keyId}:${secret}` },
      payload: { op: 'cancel_order', orderId: '42' },
    });
    expect(res.statusCode).toBe(200);
    expect(seen).toEqual([42n]);
  });
});

describe('POST /v1/tx/submit', () => {
  it('routes signed XDR to submit and returns hash + status', async () => {
    let receivedXdr: string | null = null;
    const setup = await setupTestServer({
      txOverride: {
        txCtx: { rpcUrl: 'http://stub', network: 'testnet' },
        submitService: {
          submit: async (signedXdr: string) => {
            receivedXdr = signedXdr;
            return { kind: 'success' as const, hash: 'tx-hash-abc', ledger: 123 };
          },
        },
      },
    });
    app = setup.app;
    const kp = Keypair.random();
    const address = kp.publicKey();
    const ch = await app.inject({ method: 'POST', url: '/v1/keys/challenge', payload: { address } });
    const sig = signChallengeXdr(kp, (ch.json() as { challengeHex: string }).challengeHex);
    const issued = await app.inject({
      method: 'POST',
      url: '/v1/keys',
      payload: { address, challenge: (ch.json() as { challengeHex: string }).challengeHex, signature: sig },
    });
    const { keyId, secret } = issued.json() as { keyId: string; secret: string };

    const res = await app.inject({
      method: 'POST',
      url: '/v1/tx/submit',
      headers: { authorization: `Bearer ${keyId}:${secret}` },
      payload: { signedXdr: 'AAAAAg==signed' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { hash: string; status: string };
    expect(body.hash).toBe('tx-hash-abc');
    expect(body.status).toBe('SUCCESS');
    expect(receivedXdr).toBe('AAAAAg==signed');
  });

  it('rejects unauthenticated submit', async () => {
    const setup = await setupTestServer();
    app = setup.app;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tx/submit',
      payload: { signedXdr: 'AAAAAg==' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/orders/open', () => {
  const OTHER_CONTRACT = 'CBAWCGMUS3DN57KXYKHHZ6Y7T7C27AFLCEBMHGCQXW5AUPF3X5XJBC4M';
  const traderA = Keypair.random().publicKey();
  const traderB = Keypair.random().publicKey();

  /** placed #1 (A, open), #2 (A, executed), #3 (B, cancelled), #9 (other market). */
  function seed() {
    return [
      { eventId: 'op-1', topic: 'order_placed', ledger: 100,
        payload: { topic: 'order_placed', orderId: 1, trader: traderA, triggerPrice: '650000000' } },
      { eventId: 'op-2', topic: 'order_placed', ledger: 101,
        payload: { topic: 'order_placed', orderId: 2, trader: traderA, triggerPrice: '660000000' } },
      { eventId: 'ox-2', topic: 'order_executed', ledger: 105,
        payload: { topic: 'order_executed', orderId: 2, keeperReward: '100' } },
      { eventId: 'op-3', topic: 'order_placed', ledger: 102,
        payload: { topic: 'order_placed', orderId: 3, trader: traderB, triggerPrice: '670000000' } },
      { eventId: 'oc-3', topic: 'order_cancelled', ledger: 106,
        payload: { topic: 'order_cancelled', orderId: 3, reason: 'user' } },
      { eventId: 'op-9', topic: 'order_placed', ledger: 103, contractId: OTHER_CONTRACT,
        payload: { topic: 'order_placed', orderId: 9, trader: traderA, triggerPrice: '680000000' } },
    ];
  }

  it('returns only unresolved orders on the current market by default', async () => {
    const setup = await setupTestServer({ seedEvents: seed() });
    app = setup.app;
    const res = await app.inject({ method: 'GET', url: '/v1/orders/open' });
    expect(res.statusCode).toBe(200);
    const { orders } = res.json() as { orders: { orderId: number; status: string }[] };
    expect(orders).toHaveLength(1);
    expect(orders[0]!.orderId).toBe(1);
    expect(orders[0]!.status).toBe('open');
  });

  it('folds terminal events into statuses with status=all, scoped to trader', async () => {
    const setup = await setupTestServer({ seedEvents: seed() });
    app = setup.app;
    const res = await app.inject({
      method: 'GET',
      url: `/v1/orders/open?trader=${traderA}&status=all`,
    });
    expect(res.statusCode).toBe(200);
    const { orders } = res.json() as {
      orders: { orderId: number; status: string; trader: string; triggerPrice: string }[];
    };
    // Newest first; the other-market order_placed (#9) must NOT leak in.
    expect(orders.map((o) => o.orderId)).toEqual([2, 1]);
    expect(orders[0]!.status).toBe('executed');
    expect(orders[1]!.status).toBe('open');
    expect(orders[1]!.triggerPrice).toBe('650000000');
    expect(orders.every((o) => o.trader === traderA)).toBe(true);
  });

  it('includes cancelled orders in status=all and respects limit', async () => {
    const setup = await setupTestServer({ seedEvents: seed() });
    app = setup.app;
    const all = await app.inject({ method: 'GET', url: '/v1/orders/open?status=all' });
    const { orders } = all.json() as { orders: { orderId: number; status: string }[] };
    expect(orders.map((o) => o.orderId)).toEqual([3, 2, 1]);
    expect(orders[0]!.status).toBe('cancelled');

    const limited = await app.inject({ method: 'GET', url: '/v1/orders/open?status=all&limit=1' });
    expect((limited.json() as { orders: unknown[] }).orders).toHaveLength(1);
  });

  it('returns an empty list for a trader with no orders', async () => {
    const setup = await setupTestServer({ seedEvents: seed() });
    app = setup.app;
    const res = await app.inject({
      method: 'GET',
      url: `/v1/orders/open?trader=${Keypair.random().publicKey()}`,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { orders: unknown[] }).orders).toEqual([]);
  });
});
