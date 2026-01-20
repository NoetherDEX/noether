/**
 * Script to update Market contract to use the new Vault
 *
 * Usage: npx tsx scripts/update-market-vault.ts
 */

import {
  Keypair,
  Contract,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Address,
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
const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

async function main() {
  console.log('='.repeat(60));
  console.log('Noether: Update Market Contract to Use New Vault');
  console.log('='.repeat(60));

  if (!ADMIN_SECRET) {
    console.error('ERROR: ADMIN_SECRET_KEY not found in .env file');
    process.exit(1);
  }

  const adminKeypair = Keypair.fromSecret(ADMIN_SECRET);
  const adminPublicKey = adminKeypair.publicKey();
  const sorobanRpc = new rpc.Server(RPC_URL);
  const marketContract = new Contract(MARKET_CONTRACT_ID);

  console.log('\nConfiguration:');
  console.log(`  Admin:      ${adminPublicKey}`);
  console.log(`  Market:     ${MARKET_CONTRACT_ID}`);
  console.log(`  New Vault:  ${VAULT_CONTRACT_ID}`);

  try {
    console.log('\n[1/2] Building transaction...');
    const account = await sorobanRpc.getAccount(adminPublicKey);

    // Call set_vault on Market contract
    const args = [new Address(VAULT_CONTRACT_ID).toScVal()];
    const operation = marketContract.call('set_vault', ...args);

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    console.log('\n[2/2] Simulating and submitting...');
    const simulated = await sorobanRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationError(simulated)) {
      console.error('Simulation failed:', simulated.error);
      process.exit(1);
    }

    const prepared = rpc.assembleTransaction(transaction, simulated).build();
    prepared.sign(adminKeypair);

    const response = await sorobanRpc.sendTransaction(prepared);
    console.log(`  Transaction hash: ${response.hash}`);

    if (response.status === 'ERROR') {
      console.error('Transaction failed');
      process.exit(1);
    }

    // Wait for confirmation
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
      console.log('SUCCESS! Market now points to new Vault.');
      console.log('='.repeat(60));
    } else {
      console.error('Transaction failed:', result.status);
      process.exit(1);
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
