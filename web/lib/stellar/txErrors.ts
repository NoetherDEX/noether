/**
 * Structured failure of a submitted trade transaction.
 *
 * Carries what the RPC told us (stage, hash, tx result code, decoded host or
 * contract error, fee actually charged) so the flow layer can decide whether
 * a rebuild-and-retry is worth it (see txFlow.ts / footprintGuard.ts) and so
 * the copy layer can tell the user the truth about what was charged.
 */

import type { TradeOp } from './footprintGuard';

export interface TxFailureDetails {
  /** What the user was doing; drives the copy. */
  op?: TradeOp;
  /** 'send' = rejected by the RPC before inclusion; 'apply' = included and failed on-chain. */
  stage: 'send' | 'apply';
  hash?: string;
  /** `sendTransaction` status at a send-stage failure (ERROR, TRY_AGAIN_LATER, …). */
  sendStatus?: string | null;
  /** Outer transaction result code (txFailed, txSorobanInvalid, txBadSeq, …). */
  txResultCode?: string | null;
  /** Decoded non-contract host error, e.g. { type: 'storage', code: 'exceeded_limit' }. */
  hostError?: { type: string; code: string } | null;
  /** Error(Contract, #N) when the contract itself reverted. */
  contractCode?: number | null;
  /** Fee the network kept for the attempt (stroops); null when unknown. */
  feeChargedStroops?: bigint | null;
}

export class TxFailedError extends Error {
  readonly details: TxFailureDetails;

  constructor(message: string, details: TxFailureDetails) {
    super(message);
    this.name = 'TxFailedError';
    this.details = details;
  }

  get hash(): string | undefined {
    return this.details.hash;
  }
}

export function isTxFailedError(err: unknown): err is TxFailedError {
  return err instanceof TxFailedError || (err instanceof Error && err.name === 'TxFailedError');
}
