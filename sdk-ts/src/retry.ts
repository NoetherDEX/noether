/**
 * Failure classification for the SDK's one-shot trade flow.
 *
 * Mirrors packages/tx-builders/src/footprintGuard.ts `classifyTxFailure` on
 * the gateway's JSON shape (no XDR here). A stale footprint / resource trap
 * or a full RPC queue is worth ONE rebuild: re-prepare (fresh simulation and
 * footprint), re-sign, resubmit. A contract revert never is.
 *
 * The gateway surfaces a failed submission three ways, all covered here:
 *  - 200 + status FAILED: applied on-chain and failed — `hostError` /
 *    `txResultCode` say whether a rebuild fixes it.
 *  - 400 `submission_rejected`: the RPC refused it at send time (never
 *    accepted) — same facts in the body.
 *  - 503 `try_again_later`: the RPC queue was full (never accepted).
 * Any OTHER 503 (an ingress or gateway outage) is NOT retried: the gateway
 * may already have broadcast attempt 1 and be waiting on confirmation, and a
 * rebuilt copy with a fresh sequence number could apply alongside it — two
 * leveraged positions instead of one.
 */

export interface SubmitFailureShape {
  status?: string;
  contractError?: { code?: number | null } | null;
  hostError?: { type?: string | null; code?: string | null } | null;
  /** Outer transaction result code from the gateway (txSorobanInvalid, …). */
  txResultCode?: string | null;
  /** HTTP status when the gateway rejected the submission outright. */
  httpStatus?: number;
  /** Gateway error code from the response body (`error`), e.g. 'try_again_later'. */
  errorCode?: string | null;
}

export type TradeFailureClass = 'stale_footprint' | 'try_again_later' | 'none';

const STALE_RESULT_CODES = /^(txSorobanInvalid|txInsufficientRefundableFee)$/i;

export function classifySubmitFailure(f: SubmitFailureShape): TradeFailureClass {
  if (f.contractError && typeof f.contractError.code === 'number') return 'none';
  if (f.httpStatus === 503) return f.errorCode === 'try_again_later' ? 'try_again_later' : 'none';
  // Only a send-time rejection carries rebuildable facts; every other HTTP
  // failure (validation, auth, rate limit, 5xx) is not ours to retry.
  if (f.httpStatus !== undefined && (f.httpStatus !== 400 || f.errorCode !== 'submission_rejected')) return 'none';
  // PENDING may still apply — resubmitting a rebuilt copy could double-fill.
  if (f.status !== undefined && f.status !== 'FAILED') return 'none';
  if (f.txResultCode && STALE_RESULT_CODES.test(f.txResultCode)) return 'stale_footprint';
  const he = f.hostError;
  if (he && he.code === 'exceeded_limit' && (he.type === 'storage' || he.type === 'budget')) {
    return 'stale_footprint';
  }
  return 'none';
}
