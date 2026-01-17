import { vaultContract, buildTransaction, submitTransaction, toScVal, rpc } from './client';
import type { PoolInfo } from '@/types';
import { SorobanRpc, scValToNative } from '@stellar/stellar-sdk';
import { NETWORK } from '@/lib/utils/constants';

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

    const account = await rpc.getAccount(publicKey);
    const operation = vaultContract.call('get_pool_info');

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const result = await rpc.simulateTransaction(transaction);

    if (SorobanRpc.Api.isSimulationSuccess(result) && result.result?.retval) {
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

    const account = await rpc.getAccount(publicKey);
    const operation = vaultContract.call('get_glp_price');

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const result = await rpc.simulateTransaction(transaction);

    if (SorobanRpc.Api.isSimulationSuccess(result) && result.result?.retval) {
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

    const account = await rpc.getAccount(publicKey);
    const operation = vaultContract.call('get_glp_balance', toScVal(userAddress, 'address'));

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const result = await rpc.simulateTransaction(transaction);

    if (SorobanRpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      return scValToNative(result.result.retval) as bigint;
    }

    return BigInt(0);
  } catch {
    return BigInt(0);
  }
}
