import { oracleContract, toScVal, rpc as sorobanRpc } from './client';
import type { PriceData } from '@/types';
import { rpc, scValToNative, TransactionBuilder, BASE_FEE } from '@stellar/stellar-sdk';
import { NETWORK } from '@/lib/utils/constants';

/**
 * Get price from oracle adapter (read-only)
 */
export async function getPrice(
  publicKey: string,
  asset: string
): Promise<PriceData | null> {
  try {
    const account = await sorobanRpc.getAccount(publicKey);
    const operation = oracleContract.call('get_price', toScVal(asset, 'symbol'));

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const result = await sorobanRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      return scValToNative(result.result.retval) as PriceData;
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
