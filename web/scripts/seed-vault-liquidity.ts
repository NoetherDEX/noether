/**
 * Script to seed the Vault with initial USDC liquidity
 *
 * Usage: npx tsx scripts/seed-vault-liquidity.ts
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
const VAULT_CONTRACT_ID = process.env.NEXT_PUBLIC_VAULT_ID!;
const USDC_TOKEN_ID = process.env.NEXT_PUBLIC_USDC_TOKEN_ID!;
const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

// Amount to deposit (100,000 USDC)
const DEPOSIT_AMOUNT = BigInt(100_000) * BigInt(10_000_000);

async function main() {
  console.log('='.repeat(60));
  console.log('Noether: Seed Vault with Initial Liquidity');
  console.log('='.repeat(60));

  if (!ADMIN_SECRET) {
    console.error('ERROR: ADMIN_SECRET_KEY not found in .env file');
    process.exit(1);
  }

  const adminKeypair = Keypair.fromSecret(ADMIN_SECRET);
  const adminPublicKey = adminKeypair.publicKey();
  const sorobanRpc = new rpc.Server(RPC_URL);
  const vaultContract = new Contract(VAULT_CONTRACT_ID);
  const usdcContract = new Contract(USDC_TOKEN_ID);

  console.log('\nConfiguration:');
  console.log(`  Admin:   ${adminPublicKey}`);
  console.log(`  Vault:   ${VAULT_CONTRACT_ID}`);
  console.log(`  USDC:    ${USDC_TOKEN_ID}`);
  console.log(`  Amount:  ${Number(DEPOSIT_AMOUNT) / 10_000_000} USDC`);

  try {
    // Step 1: Approve USDC spending by Vault
    console.log('\n[1/3] Approving USDC for Vault...');
    const account1 = await sorobanRpc.getAccount(adminPublicKey);
    const currentLedger = (await sorobanRpc.getLatestLedger()).sequence;
    const expirationLedger = currentLedger + 500_000; // ~1 month

    const approveArgs = [
      new Address(adminPublicKey).toScVal(),
      new Address(VAULT_CONTRACT_ID).toScVal(),
      nativeToScVal(DEPOSIT_AMOUNT * BigInt(2), { type: 'i128' }),
      nativeToScVal(expirationLedger, { type: 'u32' }),
    ];

    const approveOp = usdcContract.call('approve', ...approveArgs);
    const approveTx = new TransactionBuilder(account1, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(approveOp)
      .setTimeout(30)
      .build();

    const approveSim = await sorobanRpc.simulateTransaction(approveTx);
    if (rpc.Api.isSimulationError(approveSim)) {
      console.error('Approve simulation failed:', approveSim.error);
      process.exit(1);
    }

    const approvePrepared = rpc.assembleTransaction(approveTx, approveSim).build();
    approvePrepared.sign(adminKeypair);
    const approveResponse = await sorobanRpc.sendTransaction(approvePrepared);

    let approveResult = await sorobanRpc.getTransaction(approveResponse.hash);
    while (approveResult.status === 'NOT_FOUND') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      approveResult = await sorobanRpc.getTransaction(approveResponse.hash);
    }
    console.log('  Approval successful!');

    // Step 2: Deposit USDC to Vault
    console.log('\n[2/3] Depositing USDC to Vault...');
    const account2 = await sorobanRpc.getAccount(adminPublicKey);

    const depositArgs = [
      new Address(adminPublicKey).toScVal(),
      nativeToScVal(DEPOSIT_AMOUNT, { type: 'i128' }),
    ];

    const depositOp = vaultContract.call('deposit', ...depositArgs);
    const depositTx = new TransactionBuilder(account2, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(depositOp)
      .setTimeout(30)
      .build();

    const depositSim = await sorobanRpc.simulateTransaction(depositTx);
    if (rpc.Api.isSimulationError(depositSim)) {
      console.error('Deposit simulation failed:', depositSim.error);
      process.exit(1);
    }

    const depositPrepared = rpc.assembleTransaction(depositTx, depositSim).build();
    depositPrepared.sign(adminKeypair);
    const depositResponse = await sorobanRpc.sendTransaction(depositPrepared);

    console.log(`  Transaction hash: ${depositResponse.hash}`);

    let depositResult = await sorobanRpc.getTransaction(depositResponse.hash);
    let attempts = 0;
    while (depositResult.status === 'NOT_FOUND' && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      depositResult = await sorobanRpc.getTransaction(depositResponse.hash);
      attempts++;
      process.stdout.write('.');
    }
    console.log();

    if (depositResult.status !== 'SUCCESS') {
      console.error('Deposit failed:', depositResult.status);
      process.exit(1);
    }
    console.log('  Deposit successful!');

    // Step 3: Verify pool info
    console.log('\n[3/3] Verifying pool info...');
    const account3 = await sorobanRpc.getAccount(adminPublicKey);
    const infoOp = vaultContract.call('get_pool_info');
    const infoTx = new TransactionBuilder(account3, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(infoOp)
      .setTimeout(30)
      .build();

    const infoSim = await sorobanRpc.simulateTransaction(infoTx);
    if (rpc.Api.isSimulationSuccess(infoSim) && infoSim.result?.retval) {
      const poolInfo = scValToNative(infoSim.result.retval);
      console.log('  Pool Info:');
      console.log(`    Total USDC:  ${Number(poolInfo.total_usdc) / 10_000_000}`);
      console.log(`    Total NOE:   ${Number(poolInfo.total_glp) / 10_000_000}`);
      console.log(`    AUM:         ${Number(poolInfo.aum) / 10_000_000}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('SUCCESS! Vault is now seeded with liquidity.');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
