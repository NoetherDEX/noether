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
  // Solvency / risk / execution (83-91)
  83: 'This position was just partially liquidated — try again in a moment',
  84: 'Auto-deleveraging is not active for this market right now',
  85: 'Only winning positions can be auto-deleveraged',
  87: 'Filled worse than your acceptable price — resubmit or widen the limit',
  88: 'This market has no risk parameters configured yet',
  89: 'This order would push the market past its long/short skew cap — try a smaller size or the other side',
  90: 'The market is fully frozen right now — only order cancellation is available; it auto-resumes within 72h',
  91: 'This order only reduces your opposite position — use Close or reduce-only instead',
  92: 'Trading in this market is temporarily halted — closing positions still works',
  93: 'Withdrawals unlock a short cooldown after your latest deposit — try again shortly',
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
  // L0-20: fund isolation + full-NAV valuation
  16: 'That position or order does not belong to this vault',
  17: 'Capital is deployed in open positions — wait for the leader to free liquidity before withdrawing this much',
  18: 'Could not value the vault right now (price feed unavailable) — please retry',
  19: 'This vault has too many open positions and orders — close some first',
  20: 'Vault creation is currently restricted (allowlist or max-vaults cap)',
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

/** Coerce any thrown value (Error, string, or arbitrary) to a message string. */
function toMessageString(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err != null && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return err != null ? String(err) : '';
}

/**
 * Look up the human-readable message for a numeric contract error code.
 *
 * `context` selects the per-contract table (defaults to the NoetherError
 * market/vault table). For `vault_factory`, codes ≥ 21 fall back to the
 * NoetherError table: FactoryError now owns 1-20 (L0-20 added 16-20), and
 * leader-trade proxies surface market-side errors (positions/oracle/orders,
 * all ≥ 21 except the practically-unreachable PositionNotFound=20) through
 * the factory frame. Returns null when the code is unknown for the context.
 */
export function messageForCode(
  code: number,
  context: ContractErrorContext = 'market'
): string | null {
  return (
    TABLES[context][code] ??
    (context === 'vault_factory' && code >= 21 ? NOETHER_ERROR_MESSAGES[code] : undefined) ??
    null
  );
}

/**
 * True when an error looks like a user-initiated wallet rejection (the user
 * declined / dismissed the signature prompt). Centralized so every signing
 * path can surface one consistent line instead of the wallet's raw decline
 * string.
 */
const WALLET_REJECTION_RE = /reject|declin|denied|cancel/i;
export const WALLET_REJECTION_MESSAGE = 'Transaction rejected in wallet';
export function isWalletRejection(err: unknown): boolean {
  return WALLET_REJECTION_RE.test(toMessageString(err));
}

/**
 * Friendly copy for Stellar transaction-level result codes (the outer
 * TransactionResultCode, e.g. txBadSeq) — used when a submit fails for a
 * reason that is NOT a contract revert. Returns null for uninformative codes
 * (txSuccess / txFailed) so callers fall back to a contract-error message or a
 * generic line. Intentionally free of the words reject/declin/denied/cancel so
 * these are never re-interpreted as a wallet rejection downstream.
 */
const TX_RESULT_MESSAGES: Record<string, string> = {
  txBadSeq: 'Wallet transaction was out of sync — please try again',
  txInsufficientBalance: 'Not enough XLM to cover the network fee — add a little XLM and retry',
  txInsufficientFee: 'Network fee was too low — please try again',
  txBadAuth: "Wallet signature didn't match — reconnect your wallet and try again",
  txBadAuthExtra: "Wallet signature didn't match — reconnect your wallet and try again",
  txNoAccount: 'Your wallet account is not active on the network yet',
  txTooLate: 'The transaction expired before it reached the network — please try again',
  txTooEarly: 'The transaction was submitted too early — please try again',
  txMalformed: 'The transaction was malformed — please refresh and try again',
  txSorobanInvalid: 'The network could not process this transaction — please refresh and try again',
  txInternalError: 'The network had an internal error — please try again',
};
export function txResultCodeMessage(name: string): string | null {
  return TX_RESULT_MESSAGES[name] ?? null;
}

/**
 * Map a raw Soroban error (e.g. a message containing `Error(Contract, #N)`)
 * to a human-readable string.
 *
 * `opts.contract` selects the error table for the contract the failed call
 * targeted; omitted/undefined defaults to the NoetherError (market/vault)
 * table — the historical behavior.
 *
 * Falls back to the original message when no known contract error code is
 * found; returns '' for empty/nullish input so callers can chain
 * `|| 'Failed to …'`.
 */
export function decodeContractError(
  err: unknown,
  opts?: { contract?: ContractErrorContext }
): string {
  const message = toMessageString(err);
  const match = message.match(/Error\(Contract, #(\d+)\)/);
  if (match) {
    const mapped = messageForCode(Number(match[1]), opts?.contract ?? 'market');
    if (mapped) return mapped;
  }
  return message;
}
