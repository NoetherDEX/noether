import {
  Contract,
  rpc,
  Horizon,
  TransactionBuilder,
  Transaction,
  Networks,
  BASE_FEE,
  xdr,
  Address,
  nativeToScVal,
  scValToNative,
} from '@stellar/stellar-sdk';
import { NETWORK, CONTRACTS } from '@/lib/utils/constants';

// Horizon server for account queries (balances, etc.)
const horizonServer = new Horizon.Server(NETWORK.HORIZON_URL);

// Soroban RPC client
export const sorobanRpc = new rpc.Server(NETWORK.RPC_URL);

// Contract instances
export const marketContract = new Contract(CONTRACTS.MARKET);
export const vaultContract = new Contract(CONTRACTS.VAULT);
export const oracleContract = new Contract(CONTRACTS.ORACLE_ADAPTER);
export const usdcTokenContract = new Contract(CONTRACTS.USDC_TOKEN);

/**
 * Build a transaction for a contract call
 */
export async function buildTransaction(
  sourcePublicKey: string,
  contract: Contract,
  method: string,
  args: xdr.ScVal[]
): Promise<string> {
  const account = await sorobanRpc.getAccount(sourcePublicKey);

  const operation = contract.call(method, ...args);

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  // Simulate to get the proper footprint and fees
  const simulated = await sorobanRpc.simulateTransaction(transaction);

  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed: ${simulated.error}`);
  }

  // Prepare the transaction with the simulation results
  const prepared = rpc.assembleTransaction(transaction, simulated).build();

  // Convert to XDR string for Freighter
  // Use toXDR() which returns base64 string in browser environment
  const xdrString = prepared.toXDR();

  console.log('[DEBUG] Built transaction XDR (first 100 chars):', xdrString.substring(0, 100));

  return xdrString;
}

/**
 * Submit a signed transaction
 */
export async function submitTransaction(signedXdr: string): Promise<rpc.Api.GetTransactionResponse> {
  console.log('[DEBUG] Submitting signed XDR (first 100 chars):', signedXdr.substring(0, 100));
  console.log('[DEBUG] Full signed XDR length:', signedXdr.length);

  // Parse the signed XDR using TransactionBuilder.fromXDR
  const transaction = TransactionBuilder.fromXDR(signedXdr, NETWORK.PASSPHRASE) as Transaction;
  console.log('[DEBUG] Parsed transaction successfully');

  const response = await sorobanRpc.sendTransaction(transaction);

  console.log('[DEBUG] Send response:', response.status, response.hash);

  if (response.status === 'ERROR') {
    console.error('[DEBUG] Transaction error:', response.errorResult);
    // Try to extract meaningful error message
    let errorMessage = 'Transaction submission failed';
    try {
      if (response.errorResult) {
        errorMessage = JSON.stringify(response.errorResult, null, 2);
      }
    } catch {
      errorMessage = 'Unknown error during submission';
    }
    throw new Error(errorMessage);
  }

  // Wait for confirmation - poll until we get a final status
  let result = await sorobanRpc.getTransaction(response.hash);
  let attempts = 0;
  const maxAttempts = 30; // 30 seconds max wait

  while (result.status === 'NOT_FOUND' && attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    result = await sorobanRpc.getTransaction(response.hash);
    attempts++;
  }

  if (result.status === 'FAILED') {
    console.error('[DEBUG] Transaction failed on-chain:', result);
    // Try to extract the error from resultXdr
    let errorMessage = 'Transaction failed on-chain';
    try {
      if ('resultXdr' in result && result.resultXdr) {
        const resultXdr = result.resultXdr;
        errorMessage = `Transaction failed: ${resultXdr.result().switch().name}`;
      }
    } catch {
      // Keep default message
    }
    throw new Error(errorMessage);
  }

  if (result.status !== 'SUCCESS') {
    throw new Error(`Transaction did not complete: ${result.status}`);
  }

  console.log('[DEBUG] Transaction successful!');
  return result;
}

/**
 * Convert native types to ScVal
 */
export function toScVal(value: unknown, type: string): xdr.ScVal {
  switch (type) {
    case 'address':
      return new Address(value as string).toScVal();
    case 'symbol':
      return nativeToScVal(value as string, { type: 'symbol' });
    case 'i128':
      return nativeToScVal(BigInt(value as number | bigint), { type: 'i128' });
    case 'u32':
      return nativeToScVal(value as number, { type: 'u32' });
    case 'u64':
      return nativeToScVal(BigInt(value as number), { type: 'u64' });
    case 'bool':
      return nativeToScVal(value as boolean, { type: 'bool' });
    case 'direction':
      // Direction enum is encoded as u32: Long = 0, Short = 1
      // (confirmed via: stellar contract invoke ... -- open_position --help)
      const dirValue = (value as string) === 'Long' ? 0 : 1;
      return nativeToScVal(dirValue, { type: 'u32' });
    default:
      return nativeToScVal(value);
  }
}

/**
 * Convert ScVal to native types
 */
export function fromScVal(scVal: xdr.ScVal): unknown {
  return scValToNative(scVal);
}

/**
 * Get account XLM balance using Horizon
 */
export async function getAccountBalance(publicKey: string): Promise<number> {
  try {
    const account = await horizonServer.loadAccount(publicKey);
    const xlmBalance = account.balances.find(
      (b): b is Horizon.HorizonApi.BalanceLineNative => b.asset_type === 'native'
    );
    return xlmBalance ? parseFloat(xlmBalance.balance) : 0;
  } catch {
    return 0;
  }
}

// Re-export rpc for other modules
export { sorobanRpc as rpc };
