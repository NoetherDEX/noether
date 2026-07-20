import type { StellarAddress } from '@noether/types';
import type { xdr } from '@stellar/stellar-sdk';
import {
  buildContractTx,
  buildInvokeOp,
  type InvokeOp,
  type PreparedTx,
  type TxBuildContext,
} from '../client.js';
import { toScVal } from '../scval.js';

const METHOD = 'claim';

/**
 * L1-18 funded referral claim: referral.claim(referrer) transfers the
 * claimable USDC from the registry's own balance to the referrer. Wallet-
 * only Soroban op — never routed through gateway auth (KNOWN_ISSUES G-1).
 */
export interface ReferralClaimParams {
  referrer: StellarAddress;
}

export function buildReferralClaimArgs(params: ReferralClaimParams): xdr.ScVal[] {
  return [toScVal(params.referrer, 'address')];
}

export function buildReferralClaimOp(
  referralContractId: string,
  params: ReferralClaimParams,
): InvokeOp {
  return buildInvokeOp(referralContractId, METHOD, buildReferralClaimArgs(params));
}

export async function buildReferralClaimTx(
  ctx: TxBuildContext,
  referralContractId: string,
  params: ReferralClaimParams,
): Promise<PreparedTx> {
  return buildContractTx(
    ctx,
    params.referrer,
    referralContractId,
    METHOD,
    buildReferralClaimArgs(params),
  );
}
