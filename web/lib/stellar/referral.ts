/**
 * Direct referral contract calls — mirrors web/lib/stellar/vaultFactory.ts.
 *
 * Address read from `NEXT_PUBLIC_REFERRAL_ID`.
 */

import { Account, Address, Contract, TransactionBuilder, BASE_FEE, rpc, scValToNative } from '@stellar/stellar-sdk';
import { buildTransaction, sorobanRpc, submitTransaction, toScVal } from './client';
import { signWithWallet } from './walletKit';
import { NETWORK, NULL_ACCOUNT } from '@/lib/utils/constants';

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

/** L1-18 funded claim — returns the USDC actually paid (7-dec). */
export async function claimReferralFees(signerPublicKey: string): Promise<bigint> {
  const contract = referralContract();
  const args = [toScVal(signerPublicKey, 'address')];
  const xdr = await buildTransaction(signerPublicKey, contract, 'claim', args);
  const result = (await signAndSubmit(signerPublicKey, xdr)) as {
    status?: string;
    returnValue?: unknown;
  };
  if (result?.status === 'SUCCESS' && result.returnValue) {
    return scValToNative(result.returnValue as Parameters<typeof scValToNative>[0]) as bigint;
  }
  throw new Error('Failed to claim referral fees');
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

// ─── L1-18 funded-claim gating ──────────────────────────────────────────

/** Sequence-free view sim (NULL account) for the version/config probes. */
async function simulateViewNullSource(method: string): Promise<unknown> {
  const contract = referralContract();
  const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, '0'), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.PASSPHRASE,
  })
    .addOperation(contract.call(method))
    .setTimeout(60)
    .build();
  const sim = await sorobanRpc.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim) || !sim.result?.retval) return null;
  return scValToNative(sim.result.retval);
}

let claimsEnabledMemo: Promise<boolean> | null = null;

/**
 * SAFETY GATE: the v0 registry's claim() zeroes claimable WITHOUT paying.
 * Claims enable only when the deployed contract reports 'referral_v1' —
 * the funded implementation. false clears the memo so the flip is picked
 * up after the Batch-1 redeploy without a page release.
 */
export function referralClaimsEnabled(): Promise<boolean> {
  if (!claimsEnabledMemo) {
    claimsEnabledMemo = (async () => {
      try {
        if (!REFERRAL_CONFIGURED()) return false;
        const version = await simulateViewNullSource('version');
        const enabled = String(version) === 'referral_v1';
        if (!enabled) claimsEnabledMemo = null;
        return enabled;
      } catch {
        claimsEnabledMemo = null;
        return false;
      }
    })();
  }
  return claimsEnabledMemo;
}

/** Live economics from the registry — the UI never hardcodes 4%/10%. */
export async function getReferralConfig(): Promise<{
  discountBps: number;
  shareBps: number;
} | null> {
  try {
    const raw = (await simulateViewNullSource('get_config')) as
      | [number | bigint, number | bigint, bigint]
      | null;
    if (!raw) return null;
    return { discountBps: Number(raw[0]), shareBps: Number(raw[1]) };
  } catch {
    return null;
  }
}
