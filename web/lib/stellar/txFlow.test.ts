import { describe, expect, it, vi } from 'vitest';
import { isRetryableTradeFailure, runTradeTx, setDefaultTradeProgress } from './txFlow';
import { TxFailedError } from './txErrors';

const stale = () =>
  new TxFailedError('stale', {
    op: 'close',
    stage: 'apply',
    hash: 'abc',
    txResultCode: 'txFailed',
    hostError: { type: 'storage', code: 'exceeded_limit' },
    contractCode: null,
    feeChargedStroops: 92_339n,
  });
const contractRevert = () =>
  new TxFailedError('#30', { op: 'close', stage: 'apply', txResultCode: 'txFailed', contractCode: 30 });
const tryAgain = () => new TxFailedError('busy', { op: 'close', stage: 'send', sendStatus: 'TRY_AGAIN_LATER' });

function harness(submitResults: Array<Error | string>) {
  const build = vi.fn(async () => `xdr-${build.mock.calls.length}`);
  const sign = vi.fn(async (xdr: string) => `signed:${xdr}`);
  const queue = [...submitResults];
  const submit = vi.fn(async (_signed: string) => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next ?? 'ok';
  });
  const progress: string[] = [];
  const sleep = vi.fn(async () => {});
  return { build, sign, submit, progress, sleep };
}

describe('runTradeTx', () => {
  it('rebuilds, re-signs and resubmits exactly once on a stale-footprint trap', async () => {
    const h = harness([stale(), 'ok']);
    const out = await runTradeTx('close', h.build, h.sign, h.submit, {
      onProgress: (p) => h.progress.push(p),
      sleep: h.sleep,
    });
    expect(out).toBe('ok');
    expect(h.build).toHaveBeenCalledTimes(2);
    expect(h.sign).toHaveBeenCalledTimes(2);
    expect(h.sign.mock.calls[1]![0]).toBe('xdr-2'); // a FRESH build, not the old bytes
    expect(h.submit).toHaveBeenCalledTimes(2);
    expect(h.progress).toEqual(['building', 'signing', 'submitting', 'retrying', 'signing', 'submitting']);
    expect(h.sleep).not.toHaveBeenCalled();
  });

  it('waits before resubmitting after TRY_AGAIN_LATER', async () => {
    const h = harness([tryAgain(), 'ok']);
    await runTradeTx('close', h.build, h.sign, h.submit, { sleep: h.sleep, retryDelayMs: 2_000 });
    expect(h.sleep).toHaveBeenCalledWith(2_000);
    expect(h.build).toHaveBeenCalledTimes(2);
  });

  it('gives up after the single retry and surfaces the last failure', async () => {
    const h = harness([stale(), stale()]);
    await expect(runTradeTx('close', h.build, h.sign, h.submit, { sleep: h.sleep })).rejects.toBeInstanceOf(TxFailedError);
    expect(h.sign).toHaveBeenCalledTimes(2);
  });

  it('never retries a contract revert', async () => {
    const h = harness([contractRevert(), 'ok']);
    await expect(runTradeTx('close', h.build, h.sign, h.submit)).rejects.toThrow('#30');
    expect(h.build).toHaveBeenCalledTimes(1);
    expect(h.sign).toHaveBeenCalledTimes(1);
  });

  it('never retries a wallet rejection or a still-pending outcome', async () => {
    const h = harness(['ok']);
    const rejectingSign = vi.fn(async () => {
      throw new Error('User declined access');
    });
    await expect(runTradeTx('close', h.build, rejectingSign, h.submit)).rejects.toThrow('declined');
    expect(h.submit).not.toHaveBeenCalled();

    const pending = harness([new Error('Transaction is still confirming (abc…)')]);
    await expect(runTradeTx('close', pending.build, pending.sign, pending.submit)).rejects.toThrow('still confirming');
    expect(pending.build).toHaveBeenCalledTimes(1);
  });

  it('classifies failures for callers that need a boolean', () => {
    expect(isRetryableTradeFailure(stale())).toBe(true);
    expect(isRetryableTradeFailure(tryAgain())).toBe(true);
    expect(isRetryableTradeFailure(contractRevert())).toBe(false);
    expect(isRetryableTradeFailure(new Error('x'))).toBe(false);
  });

  it('reports through the app-wide handler when the caller passes no onProgress, and only then', async () => {
    const seen: string[] = [];
    setDefaultTradeProgress((op, p) => seen.push(`${op}:${p}`));
    try {
      const h = harness([stale(), 'ok']);
      await runTradeTx('place_order', h.build, h.sign, h.submit, { sleep: h.sleep });
      // The retry — the second wallet prompt — is announced, not silent.
      expect(seen).toEqual([
        'place_order:building', 'place_order:signing', 'place_order:submitting',
        'place_order:retrying', 'place_order:signing', 'place_order:submitting',
      ]);
      seen.length = 0;
      const own = harness(['ok']);
      await runTradeTx('place_order', own.build, own.sign, own.submit, { onProgress: () => {} });
      expect(seen).toEqual([]);
    } finally {
      setDefaultTradeProgress(null);
    }
  });
});
