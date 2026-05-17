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
      payload: { op: 'open_position', asset: 'DOGE', collateral: '100', leverage: 5, direction: 'Long' },
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
        submit: (async (_ctx: unknown, signedXdr: string) => {
          receivedXdr = signedXdr;
          return { hash: 'tx-hash-abc', status: 'SUCCESS' as const, result: undefined };
        }) as never,
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
