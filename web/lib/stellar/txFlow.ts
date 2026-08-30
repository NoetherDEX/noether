/**
 * Build → sign → submit with ONE automatic rebuild when the network state
 * moved between our simulation and our submission.
 *
 * Why: Soroban freezes a transaction's footprint at simulation. A settlement
 * branch that flips while the user is looking at the wallet prompt (the
 * vault's buffer refilled by someone else's trade, the mark crossing the
 * position's break-even, …) traps the transaction on-chain and burns the fee.
 * footprintGuard pads the keys we know about; this is the safety net for the
 * rest — rebuild with a fresh attestation and a fresh simulation, ask the
 * wallet once more, resubmit. Contract reverts are never retried: the
 * contract said no and will say no again.
 */

import { classifyTxFailure, type TradeOp } from './footprintGuard';
import { isTxFailedError } from './txErrors';

export type TradeProgress = 'building' | 'signing' | 'submitting' | 'retrying';

export interface RunTradeTxOptions {
  onProgress?: (progress: TradeProgress) => void;
  /** Automatic rebuild attempts after the first failure (default 1). */
  maxRetries?: number;
  /** Pause before resubmitting after TRY_AGAIN_LATER (default 2 000 ms). */
  retryDelayMs?: number;
  /** Test seam. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runTradeTx<T>(
  op: TradeOp,
  build: () => Promise<string>,
  sign: (xdr: string) => Promise<string>,
  submit: (signedXdr: string) => Promise<T>,
  opts: RunTradeTxOptions = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 1;
  const sleep = opts.sleep ?? defaultSleep;
  let attempt = 0;
  for (;;) {
    opts.onProgress?.(attempt === 0 ? 'building' : 'retrying');
    const xdr = await build();
    opts.onProgress?.('signing');
    const signed = await sign(xdr); // a wallet rejection propagates unchanged
    opts.onProgress?.('submitting');
    try {
      return await submit(signed);
    } catch (err) {
      const cls = isTxFailedError(err)
        ? classifyTxFailure({
            sendStatus: err.details.sendStatus,
            txResultCode: err.details.txResultCode,
            hostError: err.details.hostError,
            contractCode: err.details.contractCode,
          })
        : 'none';
      if (cls === 'none' || attempt >= maxRetries) throw err;
      attempt++;
      if (cls === 'try_again_later') await sleep(opts.retryDelayMs ?? 2_000);
      // stale_footprint: rebuild immediately — the closure refetches the
      // price round and re-simulates against the current ledger.
    }
  }
}

/** True when this failure class is worth an automatic rebuild. */
export function isRetryableTradeFailure(err: unknown): boolean {
  if (!isTxFailedError(err)) return false;
  return (
    classifyTxFailure({
      sendStatus: err.details.sendStatus,
      txResultCode: err.details.txResultCode,
      hostError: err.details.hostError,
      contractCode: err.details.contractCode,
    }) !== 'none'
  );
}

export type { TradeOp };
