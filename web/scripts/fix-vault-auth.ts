/**
 * Fix Vault Authorization
 *
 * Updates the Vault contract to point to the correct Market contract.
 * This fixes the Error(Auth, InvalidAction) when closing positions.
 *
 * Usage: npx tsx scripts/fix-vault-auth.ts
 */

import {
  Keypair,
  Contract,
  TransactionBuilder,
  Networks,
  Address,
  rpc,
} from '@stellar/stellar-sdk';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Configuration
const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY;
const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

// Contract addresses
const VAULT_ADDRESS = 'CAQVJPGEHOOIQSZLLLDEPYUORDRFKPII7Y7JVCZQHBXLTNWFJZSHNKEQ';
const CORRECT_MARKET_ADDRESS = 'CDWEMRD5VHQTLLSOGHZW5Y4GUAFLJDT5P32DWX7MU55HJGXMTNXIG6U2';

async function main() {
  console.log('');
  console.log('═'.repeat(50));
  console.log('  Fix Vault Authorization');
  console.log('═'.repeat(50));
  console.log('');

  if (!ADMIN_SECRET) {
    console.error('ERROR: ADMIN_SECRET_KEY not found in .env file');
    process.exit(1);
  }

  const adminKeypair = Keypair.fromSecret(ADMIN_SECRET);
  const sorobanRpc = new rpc.Server(RPC_URL);
  const vaultContract = new Contract(VAULT_ADDRESS);

  console.log(`Admin:   ${adminKeypair.publicKey()}`);
  console.log(`Vault:   ${VAULT_ADDRESS}`);
  console.log(`Market:  ${CORRECT_MARKET_ADDRESS}`);
  console.log('');

  try {
    // Get account
    console.log('Fetching account...');
    const account = await sorobanRpc.getAccount(adminKeypair.publicKey());

    // Build transaction
    console.log('Building transaction...');
    const tx = new TransactionBuilder(account, {
      fee: '10000000', // 1 XLM fee for priority
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        vaultContract.call(
          'set_market_contract',
          new Address(CORRECT_MARKET_ADDRESS).toScVal()
        )
      )
      .setTimeout(300) // 5 minutes
      .build();

    // Simulate
    console.log('Simulating transaction...');
    const simResponse = await sorobanRpc.simulateTransaction(tx);

    if (rpc.Api.isSimulationError(simResponse)) {
      console.error('Simulation failed:', simResponse.error);
      process.exit(1);
    }

    console.log('Simulation successful!');

    // Prepare and sign
    const preparedTx = rpc.assembleTransaction(tx, simResponse).build();
    preparedTx.sign(adminKeypair);

    // Submit
    console.log('Submitting transaction...');
    const sendResponse = await sorobanRpc.sendTransaction(preparedTx);
    console.log('Transaction hash:', sendResponse.hash);
    console.log('Status:', sendResponse.status);

    if (sendResponse.status === 'ERROR') {
      console.error('Transaction error:', sendResponse.errorResult);
      process.exit(1);
    }

    // Wait for confirmation
    console.log('Waiting for confirmation...');
    let getResponse = await sorobanRpc.getTransaction(sendResponse.hash);
    let attempts = 0;
    const maxAttempts = 60;

    while (
      (getResponse.status === 'NOT_FOUND' || getResponse.status === 'PENDING') &&
      attempts < maxAttempts
    ) {
      process.stdout.write('.');
      await new Promise((r) => setTimeout(r, 2000));
      getResponse = await sorobanRpc.getTransaction(sendResponse.hash);
      attempts++;
    }
    console.log('');

    if (getResponse.status === 'SUCCESS') {
      console.log('');
      console.log('✅ SUCCESS! Vault now points to the correct Market contract.');
      console.log('');
      console.log('You can now close positions without authorization errors.');
    } else {
      console.error('Transaction failed:', getResponse.status);
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
