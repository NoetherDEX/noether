/**
 * L0-3 shortfall claim (Batch-1 vault): pays out what the vault still owes
 * this trader from payouts it couldn't cover in full — reserve drawn first,
 * then buffer, never pause-gated. Returns the USDC actually paid (7-dec).
 */

import { scValToNative } from '@stellar/stellar-sdk';
import { vaultContract, buildTransaction, submitTransaction, toScVal } from './client';

export async function claimShortfall(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
): Promise<bigint> {
  const xdrStr = await buildTransaction(signerPublicKey, vaultContract, 'claim_shortfall', [
    toScVal(signerPublicKey, 'address'),
  ]);
  const result = await submitTransaction(await signTransaction(xdrStr));
  if (result.status === 'SUCCESS' && result.returnValue) {
    return scValToNative(result.returnValue) as bigint;
  }
  throw new Error('Failed to claim shortfall');
}
