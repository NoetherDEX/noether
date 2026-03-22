import { toScVal, rpc as sorobanRpc } from './client';
import type { PriceData } from '@/types';
import { rpc, scValToNative, TransactionBuilder, BASE_FEE, Contract } from '@stellar/stellar-sdk';
import { NETWORK, CONTRACTS } from '@/lib/utils/constants';

// Use mock oracle directly (market contract points to mock oracle, not adapter)
const oracleContract = new Contract(CONTRACTS.MOCK_ORACLE);

/**
 * Get price from oracle (read-only)
 * Calls `lastprice` on mock oracle which returns (price, timestamp)
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
