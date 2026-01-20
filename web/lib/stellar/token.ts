import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  Address,
  nativeToScVal,
  scValToNative,
  rpc,
} from '@stellar/stellar-sdk';
import { NETWORK, CONTRACTS, TRADING } from '@/lib/utils/constants';

const sorobanRpc = new rpc.Server(NETWORK.RPC_URL);
const usdcContract = new Contract(CONTRACTS.USDC_TOKEN);

/**
 * Get USDC balance for an address
 */
export async function getUSDCBalance(publicKey: string): Promise<number> {
  try {
    const account = await sorobanRpc.getAccount(publicKey);

    const operation = usdcContract.call(
      'balance',
      new Address(publicKey).toScVal()
    );

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const result = await sorobanRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      const balance = scValToNative(result.result.retval) as bigint;
      // Convert from 7 decimals to display value
      return Number(balance) / TRADING.PRECISION;
    }

    return 0;
  } catch (error) {
    console.error('Error fetching USDC balance:', error);
    return 0;
  }
}

/**
 * Get current allowance for a spender
 */
export async function getAllowance(
  ownerPublicKey: string,
  spenderAddress: string
): Promise<bigint> {
  try {
    const account = await sorobanRpc.getAccount(ownerPublicKey);

    const operation = usdcContract.call(
      'allowance',
      new Address(ownerPublicKey).toScVal(),
      new Address(spenderAddress).toScVal()
    );

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
  } catch (error) {
    console.error('Error fetching allowance:', error);
    return BigInt(0);
  }
}

/**
 * Approve spender to use tokens
 */
export async function approveUSDC(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  spenderAddress: string,
  amount: bigint
): Promise<void> {
  // Small delay to ensure any pending transactions have time to be processed
  await new Promise((r) => setTimeout(r, 1000));

  // Fetch fresh account data right before building
  const account = await sorobanRpc.getAccount(signerPublicKey);

  // Set expiration to ~30 days (in ledger sequence terms)
  const currentLedger = await sorobanRpc.getLatestLedger();
  const expirationLedger = currentLedger.sequence + 500_000;

  const operation = usdcContract.call(
    'approve',
    new Address(signerPublicKey).toScVal(),
    new Address(spenderAddress).toScVal(),
    nativeToScVal(amount, { type: 'i128' }),
    nativeToScVal(expirationLedger, { type: 'u32' })
  );

  const transaction = new TransactionBuilder(account, {
    fee: '100000', // Higher fee for priority
    networkPassphrase: NETWORK.PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  // Simulate to get footprint
  const simulated = await sorobanRpc.simulateTransaction(transaction);

  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(`Approval simulation failed: ${simulated.error}`);
  }

  // Prepare and sign
  const prepared = rpc.assembleTransaction(transaction, simulated).build();
  const signedXdr = await signTransaction(prepared.toXDR());

  // Submit
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK.PASSPHRASE);
  const response = await sorobanRpc.sendTransaction(tx);

  if (response.status === 'ERROR') {
    const errorStr = JSON.stringify(response.errorResult);

    // Check if it's a sequence error
    if (errorStr.includes('txBadSeq') || errorStr.includes('-5')) {
      throw new Error(
        'Transaction sequence conflict. This can happen if you have a pending transaction. ' +
        'Please wait 10-15 seconds and try again.'
      );
    }

    let errorMessage = 'Approval submission failed';
    try {
      if (response.errorResult) {
        errorMessage = JSON.stringify(response.errorResult, null, 2);
      }
    } catch {
      errorMessage = 'Unknown error during approval submission';
    }
    throw new Error(errorMessage);
  }

  // Wait for confirmation with timeout
  let result = await sorobanRpc.getTransaction(response.hash);
  let pollAttempts = 0;
  const maxPollAttempts = 30;

  while ((result.status === 'NOT_FOUND' || result.status === 'PENDING') && pollAttempts < maxPollAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    result = await sorobanRpc.getTransaction(response.hash);
    pollAttempts++;
  }

  if (result.status === 'FAILED') {
    let errorMessage = 'Approval transaction failed on-chain';
    try {
      if ('resultXdr' in result && result.resultXdr) {
        errorMessage = `Approval failed: ${result.resultXdr.result().switch().name}`;
      }
    } catch {
      // Keep default message
    }
    throw new Error(errorMessage);
  }

  if (result.status !== 'SUCCESS') {
    throw new Error(`Approval did not complete: ${result.status}`);
  }
}

/**
 * Mint test USDC (testnet only - requires admin)
 * For Stellar Asset Contracts (SAC), minting is done via the issuer.
 * If recipient is the issuer, we skip (issuer has unlimited balance).
 * Otherwise, we mint to the recipient (requires trustline).
 */
export async function mintTestUSDC(
  adminSecretKey: string,
  recipientPublicKey: string,
  amount: bigint
): Promise<string> {
  const { Keypair } = await import('@stellar/stellar-sdk');

  const adminKeypair = Keypair.fromSecret(adminSecretKey);
  const adminPublicKey = adminKeypair.publicKey();

  // If recipient is the issuer, they have unlimited balance by definition
  if (recipientPublicKey === adminPublicKey) {
    // For SAC tokens, issuer can't mint to themselves
    // But they can still use the token - just return a mock hash
    console.log('Recipient is issuer - no mint needed, issuer has unlimited supply');
    return 'issuer-has-unlimited-supply';
  }

  const account = await sorobanRpc.getAccount(adminPublicKey);

  const operation = usdcContract.call(
    'mint',
    new Address(recipientPublicKey).toScVal(),
    nativeToScVal(amount, { type: 'i128' })
  );

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  // Simulate
  const simulated = await sorobanRpc.simulateTransaction(transaction);

  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(`Mint simulation failed: ${simulated.error}`);
  }

  // Prepare
  const prepared = rpc.assembleTransaction(transaction, simulated).build();

  // Sign with admin key
  prepared.sign(adminKeypair);

  // Submit
  const response = await sorobanRpc.sendTransaction(prepared);

  if (response.status === 'ERROR') {
    let errorMessage = 'Mint submission failed';
    try {
      if (response.errorResult) {
        errorMessage = JSON.stringify(response.errorResult, null, 2);
      }
    } catch {
      errorMessage = 'Unknown error during mint submission';
    }
    throw new Error(errorMessage);
  }

  // Wait for confirmation with timeout
  let result = await sorobanRpc.getTransaction(response.hash);
  let attempts = 0;
  const maxAttempts = 30;

  while ((result.status === 'NOT_FOUND' || result.status === 'PENDING') && attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    result = await sorobanRpc.getTransaction(response.hash);
    attempts++;
  }

  if (result.status === 'FAILED') {
    throw new Error('Mint transaction failed on-chain');
  }

  if (result.status !== 'SUCCESS') {
    throw new Error(`Mint did not complete: ${result.status}`);
  }

  return response.hash;
}

/**
 * Check if user has sufficient allowance for the market contract
 */
export async function checkMarketAllowance(
  ownerPublicKey: string,
  requiredAmount: bigint
): Promise<{ hasAllowance: boolean; currentAllowance: bigint }> {
  const currentAllowance = await getAllowance(ownerPublicKey, CONTRACTS.MARKET);
  return {
    hasAllowance: currentAllowance >= requiredAmount,
    currentAllowance,
  };
}
