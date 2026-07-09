/**
 * toUserMessage — the single funnel that turns ANY thrown value into one
 * clean, human-readable line for a toast or inline error.
 *
 * Composes the primitives from the error-handling pass:
 *  - ApiError (gateway HTTP status + machine code) → friendly copy
 *  - contract error codes (`Error(Contract, #N)`) → per-contract message
 *  - wallet rejections + transaction-level failures already arrive as clean
 *    strings (converted at the signing layer and in submitTransaction), so
 *    they pass straight through
 *  - anything else → trimmed/truncated, or a generic fallback when empty
 *
 * Replaces the ad-hoc `humanize` / `humanizeError` helpers that were
 * copy-pasted across the referral / vault / api-key components with drifting
 * wording and inconsistent truncation.
 */

import { ApiError } from '@/lib/api/base';
import { decodeContractError, type ContractErrorContext } from '@/lib/utils/contractErrors';

const GENERIC_FALLBACK = 'Something went wrong — please try again';
const MAX_LEN = 200;

function truncate(msg: string): string {
  const t = msg.trim();
  return t.length > MAX_LEN ? `${t.slice(0, MAX_LEN)}…` : t;
}

/** Map a gateway ApiError to friendly copy — by machine code first, then by
 *  status so no raw "<status> <statusText>: <body>" ever leaks to the user.
 *  (429 and 5xx already carry friendly copy from apiError().) */
function apiErrorMessage(err: ApiError): string {
  switch (err.code) {
    case 'not_in_beta':
      return 'This wallet is not on the early-access list yet.';
    case 'invalid_signature':
      return 'Wallet signature could not be verified.';
    case 'invalid_credentials':
    case 'missing_bearer':
    case 'malformed_bearer':
    case 'stale_timestamp':
      return 'Your API session is invalid — reconnect your wallet and try again.';
    case 'region_restricted':
      return err.message || 'Trading is not available in your region.';
  }
  if (err.status === 429 || err.status >= 500) return err.message;
  if (err.status === 401 || err.status === 403) return "You don't have access to this yet.";
  if (err.status === 404) return 'Not found.';
  return truncate(err.message);
}

/**
 * The one entry point every catch block should use.
 *
 * @param opts.contract  which contract a failed call targeted, so contract
 *                        error codes decode against the right table.
 * @param opts.fallback  copy to show when the error carries no usable message.
 */
export function toUserMessage(
  err: unknown,
  opts?: { contract?: ContractErrorContext; fallback?: string },
): string {
  if (err instanceof ApiError) return apiErrorMessage(err);

  const decoded = decodeContractError(
    err,
    opts?.contract ? { contract: opts.contract } : undefined,
  );
  return truncate(decoded) || opts?.fallback || GENERIC_FALLBACK;
}
