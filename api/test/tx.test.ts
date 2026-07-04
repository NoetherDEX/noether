import { describe, expect, it, afterEach } from 'vitest';
import { Keypair, rpc, xdr } from '@stellar/stellar-sdk';
import { setupTestServer, signChallengeXdr } from './helpers.js';
import type { TxRoutesDeps, TxSubmitLike } from '../src/routes/tx.js';
import { TxSubmitService, type RpcLike } from '../src/services/txSubmit.js';
import { contractErrorFromCode, findContractError } from '../src/services/contractErrors.js';

let app: Awaited<ReturnType<typeof setupTestServer>>['app'] | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
});

function diagnosticEvent(topics: xdr.ScVal[], data: xdr.ScVal): xdr.DiagnosticEvent {
  return new xdr.DiagnosticEvent({
    inSuccessfulContractCall: false,
    event: new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      contractId: null,
      type: xdr.ContractEventType.diagnostic(),
      body: new xdr.ContractEventBody(0, new xdr.ContractEventV0({ topics, data })),
    }),
  });
}

function contractErrorEvent(code: number): xdr.DiagnosticEvent {
  return diagnosticEvent(
    [xdr.ScVal.scvSymbol('error'), xdr.ScVal.scvError(xdr.ScError.sceContract(code))],
    xdr.ScVal.scvString('escalating error to VM trap'),
  );
}

async function setupWithService(submitService: TxSubmitLike) {
  const txOverride: TxRoutesDeps = {
    txCtx: { rpcUrl: 'http://stub', network: 'testnet' },
    submitService,
  };
  const setup = await setupTestServer({ txOverride });
  app = setup.app;
  const kp = Keypair.random();
  const address = kp.publicKey();
  const ch = await app.inject({ method: 'POST', url: '/v1/keys/challenge', payload: { address } });
  const { challengeHex } = ch.json() as { challengeHex: string };
  const sig = signChallengeXdr(kp, challengeHex);
  const issued = await app.inject({
    method: 'POST',
    url: '/v1/keys',
    payload: { address, challenge: challengeHex, signature: sig },
  });
  const { keyId, secret } = issued.json() as { keyId: string; secret: string };
  return { app, headers: { authorization: `Bearer ${keyId}:${secret}` } };
}

describe('POST /v1/tx/submit error taxonomy', () => {
  it('maps FAILED to 200 with the decoded contract error number + name', async () => {
    const { app: a, headers } = await setupWithService({
      submit: async () => ({
        kind: 'failed',
        hash: 'failed-hash',
        contractError: contractErrorFromCode(22),
        resultXdr: 'AAAA==',
      }),
    });
    const res = await a.inject({
      method: 'POST', url: '/v1/tx/submit', headers, payload: { signedXdr: 'AAAAAg==' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      hash: string; status: string; contractError: { code: number; name: string }; resultXdr: string;
    };
    expect(body.hash).toBe('failed-hash');
    expect(body.status).toBe('FAILED');
    expect(body.contractError).toEqual({ code: 22, name: 'InsufficientCollateral' });
    expect(body.resultXdr).toBe('AAAA==');
  });

  it('maps TRY_AGAIN_LATER to 503 with Retry-After and a retryable body', async () => {
    const { app: a, headers } = await setupWithService({
      submit: async () => ({ kind: 'try_again_later', hash: 'later-hash' }),
    });
    const res = await a.inject({
      method: 'POST', url: '/v1/tx/submit', headers, payload: { signedXdr: 'AAAAAg==' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('2');
    const body = res.json() as { error: string; retryable: boolean; hash: string };
    expect(body.error).toBe('try_again_later');
    expect(body.retryable).toBe(true);
    expect(body.hash).toBe('later-hash');
  });

  it('maps rejected submissions to 400 with the contract error when decodable', async () => {
    const { app: a, headers } = await setupWithService({
      submit: async () => ({
        kind: 'rejected',
        hash: 'rej-hash',
        message: 'Submission rejected by RPC',
        contractError: contractErrorFromCode(30),
      }),
    });
    const res = await a.inject({
      method: 'POST', url: '/v1/tx/submit', headers, payload: { signedXdr: 'AAAAAg==' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; contractError: { code: number; name: string } };
    expect(body.error).toBe('submission_rejected');
    expect(body.contractError).toEqual({ code: 30, name: 'PriceStale' });
  });

  it('maps a poll timeout to 200 PENDING', async () => {
    const { app: a, headers } = await setupWithService({
      submit: async () => ({ kind: 'pending', hash: 'slow-hash' }),
    });
    const res = await a.inject({
      method: 'POST', url: '/v1/tx/submit', headers, payload: { signedXdr: 'AAAAAg==' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ hash: 'slow-hash', status: 'PENDING' });
  });

  it('maps transport failures to 502 rpc_error', async () => {
    const { app: a, headers } = await setupWithService({
      submit: async () => {
        throw new Error('socket hang up');
      },
    });
    const res = await a.inject({
      method: 'POST', url: '/v1/tx/submit', headers, payload: { signedXdr: 'AAAAAg==' },
    });
    expect(res.statusCode).toBe(502);
    const body = res.json() as { error: string; message: string };
    expect(body.error).toBe('rpc_error');
    expect(body.message).toContain('socket hang up');
  });
});

describe('TxSubmitService', () => {
  const ctx = { rpcUrl: 'http://stub', network: 'testnet' as const };
  const signedXdr = signChallengeXdr(Keypair.random(), 'ab'.repeat(32));

  function fakeRpc(
    send: Partial<rpc.Api.SendTransactionResponse>,
    gets: unknown[] = [],
  ): { server: RpcLike; calls: { send: number; get: string[] } } {
    const calls = { send: 0, get: [] as string[] };
    const server: RpcLike = {
      async sendTransaction() {
        calls.send += 1;
        return send as rpc.Api.SendTransactionResponse;
      },
      async getTransaction(hash: string) {
        calls.get.push(hash);
        const next = gets[Math.min(calls.get.length - 1, gets.length - 1)];
        return next as rpc.Api.GetTransactionResponse;
      },
    };
    return { server, calls };
  }

  it('treats DUPLICATE as idempotent: polls the hash and returns the prior result', async () => {
    const { server, calls } = fakeRpc(
      { status: 'DUPLICATE', hash: 'dup-hash' },
      [{ status: rpc.Api.GetTransactionStatus.SUCCESS, ledger: 777 }],
    );
    const service = new TxSubmitService(ctx, server);
    const outcome = await service.submit(signedXdr, { pollTimeoutMs: 1000, pollIntervalMs: 1 });
    expect(outcome).toEqual({ kind: 'success', hash: 'dup-hash', ledger: 777 });
    expect(calls.send).toBe(1);
    expect(calls.get).toEqual(['dup-hash']);
  });

  it('surfaces TRY_AGAIN_LATER without polling', async () => {
    const { server, calls } = fakeRpc({ status: 'TRY_AGAIN_LATER', hash: 'later-hash' });
    const service = new TxSubmitService(ctx, server);
    const outcome = await service.submit(signedXdr);
    expect(outcome).toEqual({ kind: 'try_again_later', hash: 'later-hash' });
    expect(calls.get).toEqual([]);
  });

  it('decodes the Noether contract error from a FAILED transaction', async () => {
    const { server } = fakeRpc(
      { status: 'PENDING', hash: 'fail-hash' },
      [
        {
          status: rpc.Api.GetTransactionStatus.FAILED,
          diagnosticEventsXdr: [contractErrorEvent(25)],
          resultXdr: { toXDR: () => 'RESULTB64==' },
        },
      ],
    );
    const service = new TxSubmitService(ctx, server);
    const outcome = await service.submit(signedXdr, { pollTimeoutMs: 1000, pollIntervalMs: 1 });
    expect(outcome).toEqual({
      kind: 'failed',
      hash: 'fail-hash',
      contractError: { code: 25, name: 'InsufficientMargin' },
      resultXdr: 'RESULTB64==',
    });
  });

  it('decodes the contract error from diagnostic events on a send ERROR', async () => {
    const { server, calls } = fakeRpc({
      status: 'ERROR',
      hash: 'err-hash',
      diagnosticEvents: [contractErrorEvent(3)],
    });
    const service = new TxSubmitService(ctx, server);
    const outcome = await service.submit(signedXdr);
    expect(outcome).toEqual({
      kind: 'rejected',
      hash: 'err-hash',
      message: 'Submission rejected by RPC',
      contractError: { code: 3, name: 'Unauthorized' },
    });
    expect(calls.get).toEqual([]);
  });

  it('returns pending when the poll deadline passes without a final status', async () => {
    const { server, calls } = fakeRpc(
      { status: 'PENDING', hash: 'slow-hash' },
      [{ status: rpc.Api.GetTransactionStatus.NOT_FOUND }],
    );
    const service = new TxSubmitService(ctx, server);
    const outcome = await service.submit(signedXdr, { pollTimeoutMs: 5, pollIntervalMs: 1 });
    expect(outcome).toEqual({ kind: 'pending', hash: 'slow-hash' });
    expect(calls.get.length).toBeGreaterThanOrEqual(1);
  });
});

describe('contract error decoding', () => {
  it('finds Error(Contract, #N) in diagnostic event topics', () => {
    expect(findContractError([contractErrorEvent(82)])).toEqual({
      code: 82,
      name: 'OpenInterestCapExceeded',
    });
  });

  it('ignores non-contract ScErrors and returns null', () => {
    const wasmTrap = diagnosticEvent(
      [xdr.ScVal.scvSymbol('error'), xdr.ScVal.scvError(xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecExceededLimit()))],
      xdr.ScVal.scvString('budget exceeded'),
    );
    expect(findContractError([wasmTrap])).toBeNull();
    expect(findContractError(undefined)).toBeNull();
    expect(findContractError([])).toBeNull();
  });

  it('labels unmapped codes as UnknownContractError', () => {
    expect(contractErrorFromCode(9999)).toEqual({ code: 9999, name: 'UnknownContractError' });
  });
});
