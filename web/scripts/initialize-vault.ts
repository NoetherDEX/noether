/**
 * Script to initialize the new Vault contract
 *
 * Usage: npx tsx scripts/initialize-vault.ts
 */

import {
  Keypair,
  Contract,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Address,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Configuration
const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY;
const VAULT_CONTRACT_ID = process.env.NEXT_PUBLIC_VAULT_ID!;
const MARKET_CONTRACT_ID = process.env.NEXT_PUBLIC_MARKET_ID!;
const USDC_TOKEN_ID = process.env.NEXT_PUBLIC_USDC_TOKEN_ID!;
const NOE_TOKEN_ID = process.env.NEXT_PUBLIC_NOE_TOKEN_ID!;
const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

// Fee configuration (in basis points, 100 = 1%)
const DEPOSIT_FEE_BPS = 30;  // 0.3%
const WITHDRAW_FEE_BPS = 30; // 0.3%

async function main() {
  console.log('='.repeat(60));
  console.log('Noether: Initialize Vault Contract');
  console.log('='.repeat(60));

  // Validate environment
  if (!ADMIN_SECRET) {
    console.error('ERROR: ADMIN_SECRET_KEY not found in .env file');
    process.exit(1);
  }

  // Setup
  const adminKeypair = Keypair.fromSecret(ADMIN_SECRET);
  const adminPublicKey = adminKeypair.publicKey();
  const sorobanRpc = new rpc.Server(RPC_URL);
  const vaultContract = new Contract(VAULT_CONTRACT_ID);

  console.log('\nConfiguration:');
  console.log(`  Admin:         ${adminPublicKey}`);
  console.log(`  Vault:         ${VAULT_CONTRACT_ID}`);
  console.log(`  Market:        ${MARKET_CONTRACT_ID}`);
  console.log(`  USDC Token:    ${USDC_TOKEN_ID}`);
  console.log(`  NOE Token:     ${NOE_TOKEN_ID}`);
  console.log(`  Deposit Fee:   ${DEPOSIT_FEE_BPS / 100}%`);
  console.log(`  Withdraw Fee:  ${WITHDRAW_FEE_BPS / 100}%`);

  try {
    // Step 1: Get account
    console.log('\n[1/3] Fetching account...');
    const account = await sorobanRpc.getAccount(adminPublicKey);
    console.log(`  Account sequence: ${account.sequenceNumber()}`);

    // Step 2: Build initialization transaction
    console.log('\n[2/3] Building initialization transaction...');

    // initialize(admin, usdc_token, noe_token, market_contract, deposit_fee_bps, withdraw_fee_bps)
    const args = [
      new Address(adminPublicKey).toScVal(),           // admin
      new Address(USDC_TOKEN_ID).toScVal(),            // usdc_token
      new Address(NOE_TOKEN_ID).toScVal(),             // noe_token
      new Address(MARKET_CONTRACT_ID).toScVal(),       // market_contract
      nativeToScVal(DEPOSIT_FEE_BPS, { type: 'u32' }), // deposit_fee_bps
      nativeToScVal(WITHDRAW_FEE_BPS, { type: 'u32' }),// withdraw_fee_bps
    ];

    const operation = vaultContract.call('initialize', ...args);

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    // Step 3: Simulate and submit
    console.log('\n[3/3] Simulating and submitting...');
    const simulated = await sorobanRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationError(simulated)) {
      console.error('Simulation failed:', simulated.error);

      // Check if already initialized
      if (simulated.error.includes('AlreadyInitialized') || simulated.error.includes('#1')) {
        console.log('\n  Vault is already initialized! Skipping...');
        return;
      }
      process.exit(1);
    }

    console.log('  Simulation successful!');

    // Prepare and sign
    const prepared = rpc.assembleTransaction(transaction, simulated).build();
    prepared.sign(adminKeypair);

    // Submit
    const response = await sorobanRpc.sendTransaction(prepared);
    console.log(`  Transaction hash: ${response.hash}`);

    if (response.status === 'ERROR') {
      console.error('Transaction failed:', response.errorResult);
      process.exit(1);
    }

    // Wait for confirmation
    console.log('  Waiting for confirmation...');
    let result = await sorobanRpc.getTransaction(response.hash);
    let attempts = 0;

    while (result.status === 'NOT_FOUND' && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      result = await sorobanRpc.getTransaction(response.hash);
      attempts++;
      process.stdout.write('.');
    }
    console.log();

    if (result.status === 'SUCCESS') {
      console.log('\n' + '='.repeat(60));
      console.log('SUCCESS! Vault contract initialized.');
      console.log('='.repeat(60));
      console.log(`\nVault ${VAULT_CONTRACT_ID.slice(0, 8)}... is now ready!`);
      console.log(`Market ${MARKET_CONTRACT_ID.slice(0, 8)}... is authorized.`);
    } else if (result.status === 'FAILED') {
      console.error('\nTransaction FAILED on-chain.');
      console.error('Result:', JSON.stringify(result, null, 2));
      process.exit(1);
    } else {
      console.error('\nTransaction status unknown:', result.status);
      process.exit(1);
    }

  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  }
}

main();
