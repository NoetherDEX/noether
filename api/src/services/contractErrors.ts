import { xdr } from '@stellar/stellar-sdk';

export interface ContractErrorInfo {
  code: number;
  name: string;
}

/**
 * Mirror of contracts/noether_common/src/errors.rs `NoetherError`.
 * The Rust enum cannot be imported from TS, so the number → name map is
 * duplicated here; keep the two in sync when contract errors change.
 */
const NOETHER_ERROR_NAMES: Record<number, string> = {
  1: 'NotInitialized',
  2: 'AlreadyInitialized',
  3: 'Unauthorized',
  4: 'Paused',
  5: 'InvalidParameter',
  6: 'Overflow',
  7: 'DivisionByZero',
  20: 'PositionNotFound',
  21: 'InvalidLeverage',
  22: 'InsufficientCollateral',
  23: 'PositionTooLarge',
  24: 'NotPositionOwner',
  25: 'InsufficientMargin',
  30: 'PriceStale',
  31: 'InvalidPrice',
  32: 'OracleUnavailable',
  40: 'InsufficientLiquidity',
  41: 'InvalidAmount',
  42: 'InsufficientBalance',
  43: 'DepositCapExceeded',
  50: 'NotLiquidatable',
  51: 'LiquidationFailed',
  55: 'FundingIntervalNotElapsed',
  60: 'OrderNotFound',
  61: 'OrderNotPending',
  62: 'OrderNotTriggered',
  63: 'SlippageExceeded',
  64: 'NotOrderOwner',
  65: 'InvalidTriggerPrice',
  66: 'InvalidSlippageTolerance',
  67: 'OrderAlreadyExists',
  68: 'InvalidLimitPrice',
  69: 'InvalidTrailingPercent',
  70: 'PostOnlyViolation',
  76: 'CrossMarginInsufficientBalance',
  77: 'CrossMarginInsufficientFreeMargin',
  78: 'CrossMarginNotLiquidatable',
  79: 'CrossMarginNoPositions',
  80: 'CrossMarginOrderNotSupported',
  81: 'PriceDeviationTooHigh',
  82: 'OpenInterestCapExceeded',
  83: 'LiquidationCooldown',
  84: 'AdlNotActive',
  85: 'AdlNotEligible',
  87: 'AcceptablePriceExceeded',
  88: 'AssetRiskNotConfigured',
  89: 'SkewCapExceeded',
  91: 'NetsToZero',
};

export function contractErrorFromCode(code: number): ContractErrorInfo {
  return { code, name: NOETHER_ERROR_NAMES[code] ?? 'UnknownContractError' };
}

/**
 * Scan Soroban diagnostic events for an `Error(Contract, #N)` ScVal and
 * translate it via the NoetherError map. Returns null when no contract
 * error is present (e.g. budget exhaustion, auth failures).
 */
export function findContractError(
  events: xdr.DiagnosticEvent[] | undefined | null,
): ContractErrorInfo | null {
  for (const ev of events ?? []) {
    try {
      const body = ev.event().body().v0();
      for (const val of [...body.topics(), body.data()]) {
        const code = scErrorContractCode(val);
        if (code !== null) return contractErrorFromCode(code);
      }
    } catch {
      // malformed / unexpected event shape — keep scanning
    }
  }
  return null;
}

function scErrorContractCode(val: xdr.ScVal): number | null {
  try {
    if (val.switch() !== xdr.ScValType.scvError()) return null;
    const err = val.error();
    if (err.switch() !== xdr.ScErrorType.sceContract()) return null;
    return err.contractCode();
  } catch {
    return null;
  }
}
