import { vaultContract, buildTransaction, simulateCallResult, submitTransaction, toScVal, rpc as sorobanRpc } from './client';
import type { PoolInfo } from '@/types';
import { Contract, rpc, scValToNative } from '@stellar/stellar-sdk';
import { NETWORK, CONTRACTS, NULL_ACCOUNT } from '@/lib/utils/constants';

// NOE trustline check (Horizon read) — re-exported here so the vault deposit
// gate (A28) finds it next to the deposit/withdraw flow it gates. NOTE its
// error semantics: returns false both for "no trustline" AND when the Horizon
// read itself fails — treat false as "not confirmed", not proof of absence.
export { hasNoeTrustline } from './trustline';

// R-6: LP slippage tolerance for the on-chain min-out bounds. The contract
// reverts (#66) instead of filling below quote − tolerance.
const LP_SLIPPAGE_BPS = 50n; // 0.50%
const BPS = 10_000n;

function minOut(quoted: bigint): bigint {
  return (quoted * (BPS - LP_SLIPPAGE_BPS)) / BPS;
}

/**
 * Deposit USDC and receive NOE tokens. Pre-quotes the mint via simulation
 * and bounds the real call 0.5% below it (R-6).
 */
export async function deposit(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  amount: bigint
): Promise<bigint> {
  const probeArgs = [
    toScVal(signerPublicKey, 'address'),
    toScVal(amount, 'i128'),
    toScVal(0n, 'i128'),
  ];
  const quoted = await simulateCallResult<bigint>(
    signerPublicKey, vaultContract, 'deposit', probeArgs
  );

  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(amount, 'i128'),
    toScVal(minOut(quoted), 'i128'),
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
 * Approve NOE tokens for vault to withdraw
 * Must be called before withdraw() when using real NOE tokens
 */
export async function approveNoeForWithdraw(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  noeAmount: bigint
): Promise<void> {
  const noeTokenId = CONTRACTS.NOE_TOKEN;
  if (!noeTokenId) {
    throw new Error('NOE token contract not configured');
  }

  const noeToken = new Contract(noeTokenId);

  // Get current ledger for expiration calculation
  const ledger = await sorobanRpc.getLatestLedger();
  const expirationLedger = ledger.sequence + 500_000; // ~1 month

  const args = [
    toScVal(signerPublicKey, 'address'),      // from (user)
    toScVal(CONTRACTS.VAULT, 'address'),      // spender (vault)
    toScVal(noeAmount, 'i128'),               // amount
    toScVal(expirationLedger, 'u32'),         // expiration_ledger
  ];

  const xdr = await buildTransaction(signerPublicKey, noeToken, 'approve', args);
  const signedXdr = await signTransaction(xdr);
  const result = await submitTransaction(signedXdr);

  if (result.status !== 'SUCCESS') {
    throw new Error('Failed to approve NOE for withdrawal');
  }
}

/**
 * Withdraw NOE tokens and receive USDC
 * Note: User must call approveNoeForWithdraw first
 */
export async function withdraw(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  noeAmount: bigint
): Promise<bigint> {
  // R-6: pre-quote the payout, bound the real call 0.5% below it.
  const probeArgs = [
    toScVal(signerPublicKey, 'address'),
    toScVal(noeAmount, 'i128'),
    toScVal(0n, 'i128'),
  ];
  const quoted = await simulateCallResult<bigint>(
    signerPublicKey, vaultContract, 'withdraw', probeArgs
  );

  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(noeAmount, 'i128'),
    toScVal(minOut(quoted), 'i128'),
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
 * Full LP withdraw flow — TWO transactions (= two wallet popups): approve the
 * vault to pull NOE, then withdraw. `onPhase` fires before each signature so
 * the UI can narrate "1/2 Approving NOE…" / "2/2 Withdrawing…" instead of
 * springing a surprise second popup mid-flow (A28).
 * Returns the USDC amount withdrawn (7-decimal bigint).
 */
export async function approveAndWithdraw(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  noeAmount: bigint,
  onPhase?: (phase: 1 | 2) => void
): Promise<bigint> {
  onPhase?.(1);
  await approveNoeForWithdraw(signerPublicKey, signTransaction, noeAmount);
  onPhase?.(2);
  return withdraw(signerPublicKey, signTransaction, noeAmount);
}

/**
 * Get actual USDC token balance held by the vault contract (read-only)
 * Uses the user's account as transaction source for simulation
 */
export async function getVaultUsdcBalance(publicKey: string): Promise<number | null> {
  try {
    const { TransactionBuilder, BASE_FEE, Address } = await import('@stellar/stellar-sdk');

    const usdcContract = new Contract(CONTRACTS.USDC_TOKEN);
    const account = await sorobanRpc.getAccount(publicKey);
    const operation = usdcContract.call('balance', new Address(CONTRACTS.VAULT).toScVal());

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(300)
      .build();

    const result = await sorobanRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      const balance = scValToNative(result.result.retval) as bigint;
      return Number(balance) / 10_000_000;
    }
    // Read failed / sim non-success: unknown, not zero — callers render '—'.
    return null;
  } catch (error) {
    console.error('Error fetching vault USDC balance:', error);
    return null;
  }
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
      .setTimeout(300)
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
 * Get NOE price in USDC (read-only, 7-decimal bigint).
 *
 * Returns NULL when the read fails — never a fabricated $1.00 (a fake
 * exchange rate in the deposit/withdraw preview is a money-display lie).
 * Callers render '—' with a retry, or keep last-good with a stale badge.
 * `publicKey` is only the simulation source; pass null/undefined for
 * logged-out reads (uses NULL_ACCOUNT, no getAccount fetch).
 */
export async function getNoePrice(publicKey?: string | null): Promise<bigint | null> {
  try {
    const { TransactionBuilder, BASE_FEE, Account } = await import('@stellar/stellar-sdk');

    const account = publicKey
      ? await sorobanRpc.getAccount(publicKey)
      : new Account(NULL_ACCOUNT, '0');
    const operation = vaultContract.call('get_noe_price');

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(300)
      .build();

    const result = await sorobanRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      return scValToNative(result.result.retval) as bigint;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Read the insurance buffer balance (`get_buffer_balance`) — the fund that
 * pays winning traders before LP value is touched, accumulated from a share
 * of liquidation proceeds (T3-D4). Returns null on failure (render '—',
 * never a fabricated $0). Works logged-out via NULL_ACCOUNT.
 */
export async function getInsuranceFundBalance(publicKey?: string | null): Promise<bigint | null> {
  try {
    const { TransactionBuilder, BASE_FEE, Account } = await import('@stellar/stellar-sdk');

    const account = publicKey
      ? await sorobanRpc.getAccount(publicKey)
      : new Account(NULL_ACCOUNT, '0');
    const operation = vaultContract.call('get_buffer_balance');

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(300)
      .build();

    const result = await sorobanRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      return scValToNative(result.result.retval) as bigint;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Read the vault's deposit fee in basis points from the contract
 * (`get_deposit_fee`) — replaces the hardcoded "0.3%" UI literals (A31).
 * Returns null on failure (render '—', never assume a rate).
 * Works logged-out: omit `publicKey` to simulate from NULL_ACCOUNT.
 */
export async function getVaultDepositFeeBps(publicKey?: string | null): Promise<number | null> {
  return readVaultFeeBps('get_deposit_fee', publicKey);
}

/**
 * Read the vault's withdrawal fee in basis points from the contract
 * (`get_withdraw_fee`). Same contract as getVaultDepositFeeBps.
 */
export async function getVaultWithdrawFeeBps(publicKey?: string | null): Promise<number | null> {
  return readVaultFeeBps('get_withdraw_fee', publicKey);
}

async function readVaultFeeBps(
  method: 'get_deposit_fee' | 'get_withdraw_fee',
  publicKey?: string | null
): Promise<number | null> {
  try {
    const { TransactionBuilder, BASE_FEE, Account } = await import('@stellar/stellar-sdk');

    const account = publicKey
      ? await sorobanRpc.getAccount(publicKey)
      : new Account(NULL_ACCOUNT, '0');
    const operation = vaultContract.call(method);

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(300)
      .build();

    const result = await sorobanRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      return Number(scValToNative(result.result.retval));
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get user's NOE balance (read-only)
 * Now queries the real NOE token contract directly
 */
export async function getNoeBalance(
  publicKey: string,
  userAddress: string
): Promise<bigint | null> {
  try {
    const { TransactionBuilder, BASE_FEE } = await import('@stellar/stellar-sdk');

    const account = await sorobanRpc.getAccount(publicKey);
    const operation = vaultContract.call('get_noe_balance', toScVal(userAddress, 'address'));

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(300)
      .build();

    const result = await sorobanRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      return scValToNative(result.result.retval) as bigint;
    }

    // Read failed / sim non-success: unknown, not zero.
    return null;
  } catch {
    return null;
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
      .setTimeout(300)
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
