import { toScVal, rpc as sorobanRpc } from './client';
import type { PriceData } from '@/types';
import { rpc, scValToNative, TransactionBuilder, BASE_FEE, Contract, Account } from '@stellar/stellar-sdk';
import { NETWORK, CONTRACTS, NULL_ACCOUNT } from '@/lib/utils/constants';

// On-chain price reads go through the Noeracle SEP-40 shim, which exposes
// `lastprice(asset: Symbol) -> (i128, u64)` by translating to Noeracle's
// `get_price_pers`. The shim is the only on-chain oracle in the Noeracle-only
// stack (mock_oracle / oracle_adapter are retired). NEXT_PUBLIC_NOERACLE_SHIM_ID
// must be set for the matching deploy environment.
const oracleContract = new Contract(CONTRACTS.NOERACLE_SHIM);

/**
 * Get the latest on-chain price for an asset via the Noeracle shim (read-only).
 * Calls `lastprice(asset)` → (price: i128 @ 7-decimals, timestamp: u64).
 *
 * Returns NULL when the price is unavailable (RPC failure, unknown feed,
 * simulation error). Money-display honesty: callers MUST treat null as
 * "unknown" — render '—' or keep the last good price with a stale badge.
 * NEVER coerce a null price to 0 (`priceMap[asset] || 0` paints an open long
 * as a −100% loss on one flaky RPC response).
 *
 * `publicKey` is only the simulation source; null/undefined uses the
 * well-known NULL_ACCOUNT. No account is ever fetched — simulateTransaction
 * ignores sequence numbers, so the getAccount round-trip connected wallets
 * used to pay here only doubled the read.
 */
export async function getPrice(
  publicKey: string | null | undefined,
  asset: string
): Promise<PriceData | null> {
  try {
    const account = new Account(publicKey ?? NULL_ACCOUNT, '0');
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
