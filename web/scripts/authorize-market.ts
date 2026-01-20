/**
 * Script to authorize the new Market contract on the Vault
 *
 * Usage: npx tsx scripts/authorize-market.ts
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
const VAULT_CONTRACT_ID = process.env.NEXT_PUBLIC_VAULT_ID || 'CAMBRSDQT3RQFNSHE2YLTSM766OFHCNIRJW5UVXYL3WGH2CVVLFJUI2V';
const NEW_MARKET_CONTRACT_ID = process.env.NEXT_PUBLIC_MARKET_ID || 'CDWEMRD5VHQTLLSOGHZW5Y4GUAFLJDT5P32DWX7MU55HJGXMTNXIG6U2';
const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

async function main() {
  console.log('='.repeat(60));
  console.log('Noether: Authorize Market Contract on Vault');
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
  console.log(`  Admin Public Key: ${adminPublicKey}`);
  console.log(`  Vault Contract:   ${VAULT_CONTRACT_ID}`);
  console.log(`  New Market:       ${NEW_MARKET_CONTRACT_ID}`);
  console.log(`  RPC URL:          ${RPC_URL}`);
  console.log(`  Network:          ${NETWORK_PASSPHRASE}`);

  try {
    // Step 1: Get account
    console.log('\n[1/4] Fetching account...');
    const account = await sorobanRpc.getAccount(adminPublicKey);
    console.log(`  Account sequence: ${account.sequenceNumber()}`);

    // Step 2: Build transaction
    console.log('\n[2/4] Building transaction...');
    const args = [
      new Address(NEW_MARKET_CONTRACT_ID).toScVal(), // new_market: Address
    ];

    const operation = vaultContract.call('set_market_contract', ...args);

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    // Step 3: Simulate and prepare
    console.log('\n[3/4] Simulating transaction...');
    const simulated = await sorobanRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationError(simulated)) {
      console.error('Simulation failed:', simulated.error);
      process.exit(1);
    }

    console.log('  Simulation successful!');

    // Prepare the transaction with footprint
    const prepared = rpc.assembleTransaction(transaction, simulated).build();

    // Sign the transaction
    prepared.sign(adminKeypair);

    // Step 4: Submit transaction
    console.log('\n[4/4] Submitting transaction...');
    const response = await sorobanRpc.sendTransaction(prepared);

    console.log(`  Transaction hash: ${response.hash}`);
    console.log(`  Initial status:   ${response.status}`);

    if (response.status === 'ERROR') {
      console.error('Transaction failed:', response.errorResult);
      process.exit(1);
    }

    // Wait for confirmation
    console.log('\n  Waiting for confirmation...');
    let result = await sorobanRpc.getTransaction(response.hash);
    let attempts = 0;
    const maxAttempts = 30;

    while (result.status === 'NOT_FOUND' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      result = await sorobanRpc.getTransaction(response.hash);
      attempts++;
      process.stdout.write('.');
    }
    console.log();

    if (result.status === 'SUCCESS') {
      console.log('\n' + '='.repeat(60));
      console.log('SUCCESS! Market contract authorized on Vault.');
      console.log('='.repeat(60));
      console.log(`\nVault (${VAULT_CONTRACT_ID.slice(0, 8)}...) now recognizes`);
      console.log(`Market (${NEW_MARKET_CONTRACT_ID.slice(0, 8)}...) as the authorized trading contract.`);
      console.log('\nYou can now open and close positions!');
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
