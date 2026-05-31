import { toScVal, rpc as sorobanRpc } from './client';
import type { PriceData } from '@/types';
import { rpc, scValToNative, TransactionBuilder, BASE_FEE, Contract } from '@stellar/stellar-sdk';
import { NETWORK, CONTRACTS } from '@/lib/utils/constants';

// Prefer the Noeracle shim (SEP-40-compatible, reads from Noeracle's
// signed persistent storage) once it's deployed and the env var is set.
// Fall back to the legacy Mock Oracle so the UI keeps working before
// the rollout completes. The shim's `lastprice(asset: Symbol) -> (i128, u64)`
// signature matches Mock Oracle's, so the call shape below is identical.
const oracleAddress = CONTRACTS.NOERACLE_SHIM || CONTRACTS.MOCK_ORACLE;
const oracleContract = new Contract(oracleAddress);

/**
 * Get price from oracle adapter (read-only)
 * Calls `lastprice` which fetches from configured sources, validates, and returns (price, timestamp)
 */
export async function getPrice(
  publicKey: string,
  asset: string
): Promise<PriceData | null> {
  try {
    const account = await sorobanRpc.getAccount(publicKey);
    const operation = oracleContract.call('lastprice', toScVal(asset, 'symbol'));

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(300)
      .build();

    const result = await sorobanRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      const raw = scValToNative(result.result.retval) as [bigint, bigint];
      // lastprice returns tuple (price, timestamp)
      return {
        price: raw[0],
        timestamp: Number(raw[1]),
      };
    }

    return null;
  } catch (error) {
    console.error('Error fetching price:', error);
    return null;
  }
}

/**
 * Convert contract price (7 decimals) to display price
 */
export function priceToDisplay(price: bigint): number {
  return Number(price) / 10_000_000;
}

/**
 * Convert display price to contract price (7 decimals)
 */
export function priceToContract(price: number): bigint {
  return BigInt(Math.floor(price * 10_000_000));
}
