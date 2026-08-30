/**
 * Failure classification for the SDK's one-shot trade flow.
 *
 * Mirrors packages/tx-builders/src/footprintGuard.ts `classifyTxFailure` on
 * the gateway's JSON shape (no XDR here). A stale footprint / resource trap
 * or a full RPC queue is worth ONE rebuild: re-prepare (fresh simulation and
 * footprint), re-sign, resubmit. A contract revert never is.
 */

export interface SubmitFailureShape {
  status?: string;
  contractError?: { code?: number | null } | null;
  hostError?: { type?: string | null; code?: string | null } | null;
  /** HTTP status when the gateway rejected the submission outright. */
  httpStatus?: number;
}

export type TradeFailureClass = 'stale_footprint' | 'try_again_later' | 'none';

export function classifySubmitFailure(f: SubmitFailureShape): TradeFailureClass {
  if (f.contractError && typeof f.contractError.code === 'number') return 'none';
  // The gateway answers 503 + Retry-After for an RPC TRY_AGAIN_LATER.
  if (f.httpStatus === 503) return 'try_again_later';
  const he = f.hostError;
  if (f.status === 'FAILED' && he && he.code === 'exceeded_limit' && (he.type === 'storage' || he.type === 'budget')) {
    return 'stale_footprint';
  }
  return 'none';
}
