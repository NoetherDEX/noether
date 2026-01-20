import { vaultContract, buildTransaction, submitTransaction, toScVal, rpc as sorobanRpc } from './client';
import type { PoolInfo } from '@/types';
import { rpc, scValToNative } from '@stellar/stellar-sdk';
import { NETWORK, CONTRACTS } from '@/lib/utils/constants';

/**
 * Deposit USDC (XLM on testnet) and receive GLP tokens
 */
export async function deposit(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  amount: bigint
): Promise<bigint> {
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(amount, 'i128'),
  ];

  const xdr = await buildTransaction(signerPublicKey, vaultContract, 'deposit', args);
  const signedXdr = await signTransaction(xdr);
  const result = await submitTransaction(signedXdr);

  if (result.status === 'SUCCESS' && result.returnValue) {
    return scValToNative(result.returnValue) as bigint;
  }

  throw new Error('Failed to deposit');
}

/**
 * Withdraw GLP tokens and receive USDC (XLM on testnet)
 */
export async function withdraw(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  glpAmount: bigint
): Promise<bigint> {
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(glpAmount, 'i128'),
  ];

  const xdr = await buildTransaction(signerPublicKey, vaultContract, 'withdraw', args);
  const signedXdr = await signTransaction(xdr);
  const result = await submitTransaction(signedXdr);

  if (result.status === 'SUCCESS' && result.returnValue) {
    return scValToNative(result.returnValue) as bigint;
  }

  throw new Error('Failed to withdraw');
}

/**
 * Get pool information (read-only)
 */
export async function getPoolInfo(publicKey: string): Promise<PoolInfo | null> {
  try {
    const { TransactionBuilder, BASE_FEE } = await import('@stellar/stellar-sdk');

    const account = await sorobanRpc.getAccount(publicKey);
    const operation = vaultContract.call('get_pool_info');

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const result = await sorobanRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      return scValToNative(result.result.retval) as PoolInfo;
    }

    return null;
  } catch (error) {
    console.error('Error fetching pool info:', error);
    return null;
  }
}

/**
 * Get GLP price in USDC (read-only)
 */
export async function getGlpPrice(publicKey: string): Promise<bigint> {
  try {
    const { TransactionBuilder, BASE_FEE } = await import('@stellar/stellar-sdk');

    const account = await sorobanRpc.getAccount(publicKey);
    const operation = vaultContract.call('get_glp_price');

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const result = await sorobanRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      return scValToNative(result.result.retval) as bigint;
    }

    return BigInt(10_000_000); // Default to $1.00
  } catch {
    return BigInt(10_000_000);
  }
}

/**
 * Get user's GLP balance (read-only)
 */
export async function getGlpBalance(
  publicKey: string,
  userAddress: string
): Promise<bigint> {
  try {
    const { TransactionBuilder, BASE_FEE } = await import('@stellar/stellar-sdk');

    const account = await sorobanRpc.getAccount(publicKey);
    const operation = vaultContract.call('get_glp_balance', toScVal(userAddress, 'address'));

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const result = await sorobanRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      return scValToNative(result.result.retval) as bigint;
    }

    return BigInt(0);
  } catch {
    return BigInt(0);
  }
}

/**
 * Link Market Contract to Vault (Admin function)
 * This is required for the Market contract to call settle_pnl on the Vault.
 */
export async function setMarketContract(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>
): Promise<void> {
  const args = [
    toScVal(CONTRACTS.MARKET, 'address'), // new_market: Address
  ];

  const xdr = await buildTransaction(signerPublicKey, vaultContract, 'set_market_contract', args);
  const signedXdr = await signTransaction(xdr);
  const result = await submitTransaction(signedXdr);

  if (result.status !== 'SUCCESS') {
    throw new Error('Failed to set market contract on vault');
  }
}

/**
 * Get the current market contract address from vault (read-only)
 */
export async function getMarketContract(publicKey: string): Promise<string | null> {
  try {
    const { TransactionBuilder, BASE_FEE } = await import('@stellar/stellar-sdk');

    const account = await sorobanRpc.getAccount(publicKey);
    const operation = vaultContract.call('get_market_contract');

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const result = await sorobanRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      return scValToNative(result.result.retval) as string;
    }

    return null;
  } catch (error) {
    console.error('Error fetching market contract:', error);
    return null;
  }
}

/**
 * Update Mock Oracle price (Admin function - temporary for testing)
 * Takes live prices from the UI and sends them to the oracle
 */
export async function updateOraclePrice(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  asset: string,
  priceUsd: number
): Promise<void> {
  const { Contract } = await import('@stellar/stellar-sdk');

  const mockOracleContract = new Contract(CONTRACTS.MOCK_ORACLE);

  // Convert USD price to 7 decimals (e.g., $0.45 -> 4500000, $97000 -> 970000000000)
  const priceWithDecimals = BigInt(Math.floor(priceUsd * 10_000_000));

  // Contract uses env.ledger().timestamp() internally, so only pass asset and price
  const args = [
    toScVal(asset, 'symbol'),           // asset: Symbol (e.g., "XLM", "BTC")
    toScVal(priceWithDecimals, 'i128'), // price: i128 (7 decimals)
  ];

  const xdr = await buildTransaction(signerPublicKey, mockOracleContract, 'set_price', args);
  const signedXdr = await signTransaction(xdr);
  const result = await submitTransaction(signedXdr);

  if (result.status !== 'SUCCESS') {
    throw new Error(`Failed to update oracle price for ${asset}`);
  }
}
