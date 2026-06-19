/**
 * Decode Soroban contract failures into short, user-facing messages.
 *
 * Contract errors surface as `Error(Contract, #N)` — a numeric code, never the
 * Rust variant name — so checking `message.includes('SomeVariant')` never
 * matches. We extract the number and map it via the codes defined in
 * `contracts/noether_common/src/errors.rs` (`NoetherError`).
 */

/** code → friendly message, mirroring `NoetherError` in noether_common/src/errors.rs. */
export const CONTRACT_ERROR_MESSAGES: Record<number, string> = {
  // General (1-7)
  1: 'This market is not initialized yet.',
  2: 'Already initialized.',
  3: 'You are not authorized for this action.',
  4: 'Trading is paused right now.',
  5: 'Invalid request parameter.',
  6: 'Amount is too large.',
  7: 'Calculation error — try a different amount.',
  // Positions (20-25)
  20: 'Position not found.',
  21: 'Invalid leverage. Must be between 1x and 10x.',
  22: 'Insufficient collateral. Minimum is 10 USDC.',
  23: 'Position size exceeds the maximum allowed.',
  24: 'You do not own this position.',
  25: 'Insufficient margin for this operation.',
  // Oracle (30-32)
  30: 'Price feed stale — please retry.',
  31: 'Invalid oracle price — please retry.',
  32: 'Price feed unavailable — please try again.',
  // Vault (40-42)
  40: 'Not enough vault liquidity for this trade.',
  41: 'Amount must be positive.',
  42: 'Insufficient balance.',
  // Liquidation (50-51)
  50: 'Position is healthy and cannot be liquidated.',
  51: 'Liquidation failed.',
  // Funding (55)
  55: 'Funding interval has not elapsed yet.',
  // Orders (60-70)
  60: 'Order not found.',
  61: 'Order already executed or cancelled.',
  62: 'Order trigger condition not met yet.',
  63: 'Price moved beyond your slippage tolerance.',
  64: 'You do not own this order.',
  65: 'Invalid trigger price for this order.',
  66: 'Invalid slippage tolerance.',
  67: 'This position already has that order type attached.',
  68: 'Invalid limit price.',
  69: 'Invalid trailing percentage.',
  70: 'Post-only order would execute immediately.',
  // Cross-margin (76-79)
  76: 'Cross-margin pool has insufficient balance.',
  77: 'Insufficient free margin — reduce positions first.',
  78: 'Cross-margin account is not liquidatable.',
  79: 'No cross-margin positions found.',
};

/** Coerce any thrown value into its message string. */
function messageOf(input: unknown): string {
  if (input instanceof Error) return input.message;
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object' && 'message' in input) {
    return String((input as { message: unknown }).message ?? '');
  }
  return '';
}

/** Pull the numeric contract error code out of a raw error/message, if present. */
export function extractContractErrorCode(input: unknown): number | null {
  const msg = messageOf(input);
  // Soroban formats contract errors as `Error(Contract, #30)`; fall back to bare `#30`.
  const m = msg.match(/Error\(Contract,\s*#?(\d+)\)/) ?? msg.match(/#(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Turn a raw Soroban/contract error into a short, user-facing message.
 * Returns the mapped message when a known contract code is found; otherwise the
 * original message passes through (so network/other errors keep their detail).
 * Idempotent: an already-friendly message has no `#code`, so it is returned as-is.
 */
export function decodeContractError(input: unknown): string {
  const code = extractContractErrorCode(input);
  if (code != null && CONTRACT_ERROR_MESSAGES[code]) {
    return CONTRACT_ERROR_MESSAGES[code];
  }
  return messageOf(input) || 'Something went wrong — please try again.';
}
