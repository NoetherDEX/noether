/**
 * User-facing copy for transaction outcomes that are NOT contract reverts.
 *
 * Rules: say exactly what happened and what was charged; name the thing the
 * user was doing (position / order / trade) — never reuse open-flow wording
 * on a close; never use the words reject/declin/denied/cancel, which the page
 * error mappers reinterpret as a wallet rejection.
 */

import type { TradeOp } from '../stellar/footprintGuard';

interface Nouns {
  /** "your close" / "your trade" / "your order" */
  action: string;
  /** What stayed untouched. */
  untouched: string;
}

function nouns(op: TradeOp | undefined): Nouns {
  switch (op) {
    case 'close':
    case 'close_partial':
    case 'close_cross':
      return { action: 'your close', untouched: 'Your position is untouched and still open.' };
    case 'open':
    case 'open_cross':
      return { action: 'your trade', untouched: 'No position was opened and your collateral did not move.' };
    case 'place_order':
    case 'execute_order':
      return { action: 'your order', untouched: 'Your order was not placed or changed.' };
    case 'cancel_order':
      return { action: 'your order update', untouched: 'Your order was not changed.' };
    case 'liquidate':
    case 'liquidate_cross':
    case 'adl':
      return { action: 'the liquidation', untouched: 'The position is unchanged.' };
    default:
      return { action: 'your transaction', untouched: 'Nothing else moved.' };
  }
}

/** Stroops → "0.0092" (XLM, up to 7 decimals, trailing zeros trimmed). */
export function feeChargedXlm(stroops: bigint | null | undefined): string | undefined {
  if (stroops === null || stroops === undefined || stroops <= 0n) return undefined;
  const whole = stroops / 10_000_000n;
  const frac = (stroops % 10_000_000n).toString().padStart(7, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

/**
 * The network state moved between our simulation and our submission and the
 * transaction failed on-chain (a footprint / resource trap). The attempt's
 * fee IS charged by the network — say so.
 */
export function staleFootprintMessage(op: TradeOp | undefined, feeXlm?: string): string {
  const n = nouns(op);
  const fee = feeXlm ? `A small network fee (${feeXlm} XLM) was charged for the attempt` : 'A small network fee was charged for the attempt';
  return (
    `The vault's state changed while ${n.action} was in flight, so the network could not apply it. ` +
    `${n.untouched} ${fee} — nothing else moved. Please try again.`
  );
}

/** Shown while the app rebuilds and asks the wallet to sign once more. */
export function retryProgressMessage(op: TradeOp | undefined): string {
  const n = nouns(op);
  return `Network state changed mid-flight — re-checking ${n.action} and asking your wallet to sign once more.`;
}

/**
 * The RPC's queue was full; the transaction was NOT accepted. Thrown at the
 * submit site, which does not know whether its caller retries (txFlow does,
 * once; vault deposits, referral and shortfall flows do not) — so the copy
 * never promises a retry. The retrying layer announces its own retry via
 * `retryProgressMessage`.
 */
export function tryAgainLaterMessage(op: TradeOp | undefined): string {
  const n = nouns(op);
  return `The network is busy — ${n.action} was not submitted. ${n.untouched} Please try again in a moment.`;
}

/** Generic on-chain failure with no decodable reason. */
export function genericFailureMessage(op: TradeOp | undefined, feeXlm?: string): string {
  const n = nouns(op);
  const fee = feeXlm ? ` A small network fee (${feeXlm} XLM) was charged for the attempt.` : '';
  return `The network could not apply ${n.action}. ${n.untouched}${fee} Please try again.`;
}
