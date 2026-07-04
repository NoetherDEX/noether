/**
 * Human-readable messages for NoetherError codes surfaced by Soroban as
 * `Error(Contract, #N)`. Codes mirror contracts/noether_common/src/errors.rs.
 */
const CONTRACT_ERROR_MESSAGES: Record<number, string> = {
  // General (1-19)
  1: 'Contract not initialized',
  2: 'Contract already initialized',
  3: 'Not authorized for this operation',
  4: 'Trading is currently paused',
  5: 'Invalid input parameter',
  6: 'Amount too large — arithmetic overflow',
  7: 'Division by zero',
  // Positions (20-29)
  20: 'Position not found — it may already be closed',
  21: 'Invalid leverage — must be between 1x and 10x',
  22: 'Insufficient collateral — minimum is 10 USDC',
  23: 'Position size exceeds the maximum allowed',
  24: 'You do not own this position',
  25: 'Insufficient margin for this operation',
  // Oracle (30-39)
  30: 'Price feed stale — please retry',
  31: 'Invalid oracle price — please retry',
  32: 'Oracle unavailable — please retry',
  // Vault (40-49)
  40: 'Insufficient liquidity in the vault',
  41: 'Amount must be positive',
  42: 'Insufficient balance',
  // Liquidation (50-54)
  50: 'Position is healthy and cannot be liquidated',
  51: 'Liquidation failed',
  // Funding (55-59)
  55: 'Funding interval has not elapsed yet',
  // Orders (60-75)
  60: 'Order not found — it may already be executed or cancelled',
  61: 'Order is no longer pending',
  62: 'Order trigger condition not met',
  63: 'Price moved beyond your slippage tolerance',
  64: 'You do not own this order',
  65: 'Invalid trigger price for this position',
  66: 'Invalid slippage tolerance',
  67: 'Position already has this type of order attached',
  68: 'Invalid limit price',
  69: 'Invalid trailing percentage — must be 0.01% to 50%',
  70: 'Post-only order would execute immediately',
  // Cross-margin (76-80)
  76: 'Cross-margin pool balance too low',
  77: 'Withdrawal would leave insufficient free margin',
  78: 'Cross-margin account is not liquidatable',
  79: 'No cross-margin positions found',
};

/**
 * Map a raw Soroban error (e.g. a message containing `Error(Contract, #30)`)
 * to a human-readable string. Falls back to the original message when no
 * known contract error code is found; returns '' for empty/nullish input so
 * callers can chain `|| 'Failed to …'`.
 */
export function decodeContractError(err: unknown): string {
  const message =
    typeof err === 'string'
      ? err
      : err != null && typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : err != null
          ? String(err)
          : '';
  const match = message.match(/Error\(Contract, #(\d+)\)/);
  if (match) {
    const mapped = CONTRACT_ERROR_MESSAGES[Number(match[1])];
    if (mapped) return mapped;
  }
  return message;
}
