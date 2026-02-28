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
      .setTimeout(300)
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
    .setTimeout(300)
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

  while (result.status === 'NOT_FOUND' && attempts < maxAttempts) {
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

