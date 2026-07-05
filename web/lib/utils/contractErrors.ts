/**
 * Human-readable messages for contract errors surfaced by Soroban as
 * `Error(Contract, #N)`. Error codes are PER-CONTRACT enums, so the decoder
 * must know which contract the failed call targeted: the same #6 means
 * "arithmetic overflow" (NoetherError) on the market but "not the vault
 * leader" (FactoryError) on the vault factory. Pass the `contract` option
 * to select the right table — the default (market/vault) preserves the
 * historical behavior.
 */

/** Which contract a failed call targeted. `market` and `vault` share the
 *  NoetherError table (contracts/noether_common/src/errors.rs). */
export type ContractErrorContext = 'market' | 'vault' | 'vault_factory' | 'referral';

/** NoetherError — shared by the market + vault contracts. */
const NOETHER_ERROR_MESSAGES: Record<number, string> = {
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
  43: 'Deposit would exceed the per-account cap',
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
  80: 'Stop-loss/take-profit orders are not supported on cross-margin positions',
  81: 'Price moved too fast — please retry in a moment',
  82: 'Open interest cap reached for this market — try a smaller size',
};

/** FactoryError — contracts/vault_factory/src/types.rs. */
const FACTORY_ERROR_MESSAGES: Record<number, string> = {
  1: 'Vault factory already initialized',
  2: 'Vault factory not initialized',
  3: 'Invalid parameter',
  4: 'Invalid vault name',
  5: 'Vault not found',
  6: 'Only the vault leader can do this',
  7: 'Not authorized (admin only)',
  8: 'Amount must be positive',
  9: 'You are trying to withdraw more shares than you own',
  10: 'The vault does not have enough free USDC for this withdrawal',
  11: 'Leaders must keep at least 5% of the vault — this withdrawal would drop below the minimum',
  12: 'This vault is paused',
  13: 'Amount too large — arithmetic overflow',
  14: 'Could not compute the vault share price — please retry',
  15: 'No performance fees to claim yet',
};

/** ReferralError — contracts/referral/src/types.rs. */
const REFERRAL_ERROR_MESSAGES: Record<number, string> = {
  1: 'Referral contract already initialized',
  2: 'Referral contract not initialized',
  3: 'Not authorized (admin only)',
  4: 'Only the market contract can record trades',
  5: 'Invalid parameter',
  6: 'Referral code too short — use at least 3 characters',
  7: 'Referral code too long — use at most 16 characters',
  8: 'That referral code is already taken',
  9: 'This wallet already has a referral code',
  10: 'Unknown referral code',
  11: 'This wallet is already linked to a referrer',
  12: 'You cannot refer yourself',
  13: 'Not enough trading volume yet to create a referral code',
  14: 'Nothing to claim yet',
  15: 'Amount too large — arithmetic overflow',
};

const TABLES: Record<ContractErrorContext, Record<number, string>> = {
  market: NOETHER_ERROR_MESSAGES,
  vault: NOETHER_ERROR_MESSAGES,
  vault_factory: FACTORY_ERROR_MESSAGES,
  referral: REFERRAL_ERROR_MESSAGES,
};

/**
 * Map a raw Soroban error (e.g. a message containing `Error(Contract, #N)`)
 * to a human-readable string.
 *
 * `opts.contract` selects the error table for the contract the failed call
 * targeted; omitted/undefined defaults to the NoetherError (market/vault)
 * table — the historical behavior. For `vault_factory`, codes ≥ 20 fall
 * back to the NoetherError table: factory codes stop at 15, and the leader
 * trade proxies bubble market-side errors (positions/oracle/orders) through
 * the factory frame.
 *
 * Falls back to the original message when no known contract error code is
 * found; returns '' for empty/nullish input so callers can chain
 * `|| 'Failed to …'`.
 */
export function decodeContractError(
  err: unknown,
  opts?: { contract?: ContractErrorContext }
): string {
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
    const code = Number(match[1]);
    const context = opts?.contract ?? 'market';
    const mapped =
      TABLES[context][code] ??
      // Factory leader-trade proxies surface market errors (codes ≥ 20,
      // outside FactoryError's 1-15 range — no collision possible).
      (context === 'vault_factory' && code >= 20 ? NOETHER_ERROR_MESSAGES[code] : undefined);
    if (mapped) return mapped;
  }
  return message;
}
