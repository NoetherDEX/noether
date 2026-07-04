/**
 * Direct referral contract calls — mirrors web/lib/stellar/vaultFactory.ts.
 *
 * Address read from `NEXT_PUBLIC_REFERRAL_ID`.
 */

import { Address, Contract, TransactionBuilder, BASE_FEE, rpc, scValToNative } from '@stellar/stellar-sdk';
import { buildTransaction, sorobanRpc, submitTransaction, toScVal } from './client';
import { signWithWallet } from './walletKit';
import { NETWORK } from '@/lib/utils/constants';

function getReferralAddress(): string {
  const addr = process.env.NEXT_PUBLIC_REFERRAL_ID;
  if (!addr) {
    throw new Error(
      'referral contract not configured — set NEXT_PUBLIC_REFERRAL_ID once the contract is deployed.',
    );
  }
  return addr;
}

function referralContract(): Contract {
  return new Contract(getReferralAddress());
}

async function signAndSubmit(signerPublicKey: string, xdr: string): Promise<unknown> {
  const signedXdr = await signWithWallet(xdr, {
    networkPassphrase: NETWORK.PASSPHRASE,
    address: signerPublicKey,
  });
  return submitTransaction(signedXdr);
}

export async function createReferralCode(
  signerPublicKey: string,
  code: string,
): Promise<void> {
  const contract = referralContract();
  const args = [toScVal(signerPublicKey, 'address'), toScVal(code, 'string')];
  const xdr = await buildTransaction(signerPublicKey, contract, 'create_code', args);
  await signAndSubmit(signerPublicKey, xdr);
}

export async function setReferrer(
  signerPublicKey: string,
  code: string,
): Promise<void> {
  const contract = referralContract();
  const args = [toScVal(signerPublicKey, 'address'), toScVal(code, 'string')];
  const xdr = await buildTransaction(signerPublicKey, contract, 'set_referrer', args);
  await signAndSubmit(signerPublicKey, xdr);
}

export async function claimReferralFees(signerPublicKey: string): Promise<void> {
  const contract = referralContract();
  const args = [toScVal(signerPublicKey, 'address')];
  const xdr = await buildTransaction(signerPublicKey, contract, 'claim', args);
  await signAndSubmit(signerPublicKey, xdr);
}

// ─── Read-only views ────────────────────────────────────────────────────

async function simulateView(method: string, args: any[], source: string): Promise<unknown> {
  const contract = referralContract();
  const account = await sorobanRpc.getAccount(source);
  const op = contract.call(method, ...args);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();
  const sim = await sorobanRpc.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  if (!sim.result?.retval) return null;
  return scValToNative(sim.result.retval);
}

/** Availability of a referral code: taken / free / unknown (check failed). */
export type CodeAvailability = 'taken' | 'free' | 'unknown';

/** Resolve a code via the contract's `resolve_code` view. */
export async function lookupCode(source: string, code: string): Promise<CodeAvailability> {
  try {
    const v = await simulateView('resolve_code', [toScVal(code, 'string')], source);
    return typeof v === 'string' ? 'taken' : 'free';
  } catch {
    return 'unknown';
  }
}

export const REFERRAL_CONFIGURED = (): boolean =>
  Boolean(process.env.NEXT_PUBLIC_REFERRAL_ID);
