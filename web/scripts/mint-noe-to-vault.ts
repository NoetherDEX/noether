/**
 * Mint NOE to Vault Script (via SAC)
 *
 * Mints NOE tokens to the vault contract using the Stellar Asset Contract (SAC).
 * This uses Soroban operations which work with contracts (no classic trustline needed).
 *
 * Prerequisites:
 * - NOE classic asset created (Admin as issuer)
 * - SAC deployed for NOE (run create-noe-asset.ts first)
 *
 * Usage: npx tsx scripts/mint-noe-to-vault.ts <vault_contract_id>
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
  scValToNative,
} from '@stellar/stellar-sdk';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Configuration
const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY;
const ADMIN_PUBLIC = process.env.ADMIN_PUBLIC_KEY;
const NOE_TOKEN_ID = process.env.NEXT_PUBLIC_NOE_TOKEN_ID;
const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

// Amount to mint (1 billion NOE with 7 decimals)
const INITIAL_SUPPLY = BigInt(1_000_000_000) * BigInt(10_000_000);

async function main() {
  console.log('');
  console.log('═'.repeat(60));
  console.log('  Mint NOE to Vault Script (via SAC)');
  console.log('═'.repeat(60));
  console.log('');

  // Get vault contract ID from command line
  const vaultContractId = process.argv[2];
  if (!vaultContractId) {
    console.error('ERROR: Vault contract ID required');
    console.error('Usage: npx tsx scripts/mint-noe-to-vault.ts <vault_contract_id>');
    process.exit(1);
  }

  // Validate environment
  if (!ADMIN_SECRET || !ADMIN_PUBLIC) {
    console.error('ERROR: ADMIN_SECRET_KEY and ADMIN_PUBLIC_KEY must be set in .env');
    process.exit(1);
  }

  if (!NOE_TOKEN_ID) {
    console.error('ERROR: NEXT_PUBLIC_NOE_TOKEN_ID not set in .env');
    console.error('Run create-noe-asset.ts first to deploy the SAC.');
    process.exit(1);
  }

  const adminKeypair = Keypair.fromSecret(ADMIN_SECRET);
  const sorobanRpc = new rpc.Server(RPC_URL);
  const noeContract = new Contract(NOE_TOKEN_ID);

  console.log('Configuration:');
  console.log(`  Admin:          ${ADMIN_PUBLIC.slice(0, 8)}...${ADMIN_PUBLIC.slice(-8)}`);
  console.log(`  NOE SAC:        ${NOE_TOKEN_ID}`);
  console.log(`  Vault Contract: ${vaultContractId}`);
  console.log(`  Amount to Mint: ${Number(INITIAL_SUPPLY) / 10_000_000} NOE`);
  console.log('');

  try {
    // Step 1: Check current vault NOE balance
    console.log('[1/3] Checking current vault balance...');
    const balanceOp = noeContract.call(
      'balance',
      new Address(vaultContractId).toScVal()
    );

    const account1 = await sorobanRpc.getAccount(ADMIN_PUBLIC);
    const balanceTx = new TransactionBuilder(account1, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(balanceOp)
      .setTimeout(30)
      .build();

    const balanceSim = await sorobanRpc.simulateTransaction(balanceTx);
    let currentBalance = BigInt(0);
    if (rpc.Api.isSimulationSuccess(balanceSim) && balanceSim.result?.retval) {
      currentBalance = scValToNative(balanceSim.result.retval) as bigint;
    }
    console.log(`  Current vault NOE: ${Number(currentBalance) / 10_000_000}`);

    if (currentBalance > BigInt(0)) {
      console.log('');
      console.log('  ⚠ Vault already has NOE. Press Ctrl+C to cancel or wait 5 seconds...');
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    console.log('');

    // Step 2: Mint NOE to vault using SAC
    // For classic assets wrapped in SAC, the issuer can use 'mint' to create tokens
    // The issuer (Admin) must sign this transaction
    console.log('[2/3] Minting NOE to vault via SAC...');

    const account2 = await sorobanRpc.getAccount(ADMIN_PUBLIC);

    // SAC mint function: mint(to: Address, amount: i128)
    // This is called by the asset issuer to create new tokens
    const mintArgs = [
      new Address(vaultContractId).toScVal(),    // to: vault contract
      nativeToScVal(INITIAL_SUPPLY, { type: 'i128' }), // amount
    ];

    const mintOp = noeContract.call('mint', ...mintArgs);

    const mintTx = new TransactionBuilder(account2, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(mintOp)
      .setTimeout(30)
      .build();

    const mintSim = await sorobanRpc.simulateTransaction(mintTx);

    if (rpc.Api.isSimulationError(mintSim)) {
      console.error('  ✗ Mint simulation failed:', mintSim.error);
      process.exit(1);
    }

    const mintPrepared = rpc.assembleTransaction(mintTx, mintSim).build();
    mintPrepared.sign(adminKeypair);

    console.log('  Submitting transaction...');
    const mintResponse = await sorobanRpc.sendTransaction(mintPrepared);
    console.log(`  Transaction hash: ${mintResponse.hash}`);

    // Wait for confirmation
    let mintResult = await sorobanRpc.getTransaction(mintResponse.hash);
    let attempts = 0;
    while (mintResult.status === 'NOT_FOUND' && attempts < 30) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      mintResult = await sorobanRpc.getTransaction(mintResponse.hash);
      attempts++;
      process.stdout.write('.');
    }
    console.log('');

    if (mintResult.status !== 'SUCCESS') {
      console.error('  ✗ Mint transaction failed:', mintResult.status);
      process.exit(1);
    }
    console.log('  ✓ Mint successful!');
    console.log('');

    // Step 3: Verify final balance
    console.log('[3/3] Verifying final balance...');
    const account3 = await sorobanRpc.getAccount(ADMIN_PUBLIC);
    const verifyTx = new TransactionBuilder(account3, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(balanceOp)
      .setTimeout(30)
      .build();

    const verifySim = await sorobanRpc.simulateTransaction(verifyTx);
    let finalBalance = BigInt(0);
    if (rpc.Api.isSimulationSuccess(verifySim) && verifySim.result?.retval) {
      finalBalance = scValToNative(verifySim.result.retval) as bigint;
    }

    console.log('');
    console.log('═'.repeat(60));
    console.log('  Minting Complete!');
    console.log('═'.repeat(60));
    console.log('');
    console.log(`  Vault NOE Balance: ${Number(finalBalance) / 10_000_000} NOE`);
    console.log('');
    console.log('Next Steps:');
    console.log('  1. Initialize new vault with NOE token address');
    console.log('  2. Migrate USDC from old vault to new vault');
    console.log('  3. Update market contract to point to new vault');
    console.log('  4. Update frontend .env with new contract addresses');
    console.log('');

  } catch (error: any) {
    console.error('Error:', error.message);
    if (error.response?.data) {
      console.error('Details:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
