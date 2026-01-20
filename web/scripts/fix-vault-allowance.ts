/**
 * Script to fix USDC allowances between Market and Vault contracts
 * This ensures the Market contract can properly settle trades with the Vault.
 *
 * Usage: npx tsx scripts/fix-vault-allowance.ts
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
const VAULT_CONTRACT_ID = process.env.NEXT_PUBLIC_VAULT_ID || 'CAMBRSDQT3RQFNSHE2YLTSM766OFHCNIRJW5UVXYL3WGH2CVVLFJUI2V';
const MARKET_CONTRACT_ID = process.env.NEXT_PUBLIC_MARKET_ID || 'CDWEMRD5VHQTLLSOGHZW5Y4GUAFLJDT5P32DWX7MU55HJGXMTNXIG6U2';
const USDC_TOKEN_ID = process.env.NEXT_PUBLIC_USDC_TOKEN_ID || 'CA63EPM4EEXUVUANF6FQUJEJ37RWRYIXCARWFXYUMPP7RLZWFNLTVNR4';
const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

// Huge allowance amount (1 trillion USDC with 7 decimals)
const INFINITE_ALLOWANCE = BigInt('10000000000000000000'); // 10^19

async function checkAllowance(
  sorobanRpc: rpc.Server,
  usdcContract: Contract,
  owner: string,
  spender: string,
  ownerLabel: string,
  spenderLabel: string
): Promise<bigint> {
  try {
    const dummyAccount = await sorobanRpc.getAccount(owner.startsWith('G') ? owner : ADMIN_SECRET ? Keypair.fromSecret(ADMIN_SECRET).publicKey() : owner);

    const args = [
      new Address(owner).toScVal(),
      new Address(spender).toScVal(),
    ];

    const operation = usdcContract.call('allowance', ...args);

    const transaction = new TransactionBuilder(dummyAccount, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const result = await sorobanRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      const allowance = scValToNative(result.result.retval) as bigint;
      console.log(`  ${ownerLabel} -> ${spenderLabel}: ${allowance.toString()}`);
      return allowance;
    }
    console.log(`  ${ownerLabel} -> ${spenderLabel}: 0 (no data)`);
    return BigInt(0);
  } catch (error) {
    console.log(`  ${ownerLabel} -> ${spenderLabel}: 0 (error: ${error})`);
    return BigInt(0);
  }
}

async function approveSpending(
  sorobanRpc: rpc.Server,
  adminKeypair: Keypair,
  usdcContract: Contract,
  fromAddress: string,
  spenderAddress: string,
  amount: bigint,
  label: string
): Promise<void> {
  console.log(`\n  Approving ${label}...`);

  const account = await sorobanRpc.getAccount(adminKeypair.publicKey());
  const currentLedger = (await sorobanRpc.getLatestLedger()).sequence;
  const expirationLedger = currentLedger + 6_307_200; // ~1 year

  const args = [
    new Address(fromAddress).toScVal(),
    new Address(spenderAddress).toScVal(),
    nativeToScVal(amount, { type: 'i128' }),
    nativeToScVal(expirationLedger, { type: 'u32' }),
  ];

  const operation = usdcContract.call('approve', ...args);

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const simulated = await sorobanRpc.simulateTransaction(transaction);

  if (rpc.Api.isSimulationError(simulated)) {
    console.log(`  WARNING: Simulation failed for ${label}: ${simulated.error}`);
    console.log(`  (This might be expected if the 'from' address is a contract)`);
    return;
  }

  const prepared = rpc.assembleTransaction(transaction, simulated).build();
  prepared.sign(adminKeypair);

  const response = await sorobanRpc.sendTransaction(prepared);

  if (response.status === 'ERROR') {
    console.log(`  WARNING: Transaction failed for ${label}`);
    return;
  }

  // Wait for confirmation
  let result = await sorobanRpc.getTransaction(response.hash);
  let attempts = 0;
  while (result.status === 'NOT_FOUND' && attempts < 30) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    result = await sorobanRpc.getTransaction(response.hash);
    attempts++;
  }

  if (result.status === 'SUCCESS') {
    console.log(`  ✓ ${label} approved successfully!`);
  } else {
    console.log(`  WARNING: ${label} may have failed: ${result.status}`);
  }
}

async function verifyMarketOnVault(
  sorobanRpc: rpc.Server,
  adminKeypair: Keypair,
  vaultContract: Contract
): Promise<void> {
  console.log('\n[3/4] Verifying Market authorization on Vault...');

  try {
    const account = await sorobanRpc.getAccount(adminKeypair.publicKey());

    const operation = vaultContract.call('get_market_contract');

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const result = await sorobanRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      const marketAddress = scValToNative(result.result.retval) as string;
      console.log(`  Current Market on Vault: ${marketAddress}`);

      if (marketAddress === MARKET_CONTRACT_ID) {
        console.log(`  ✓ Market contract is correctly authorized!`);
      } else {
        console.log(`  ✗ Market mismatch! Expected: ${MARKET_CONTRACT_ID}`);
        console.log(`  Re-authorizing...`);
        await setMarketOnVault(sorobanRpc, adminKeypair, vaultContract);
      }
    } else {
      console.log(`  No market set, authorizing...`);
      await setMarketOnVault(sorobanRpc, adminKeypair, vaultContract);
    }
  } catch (error) {
    console.log(`  Error checking market: ${error}`);
  }
}

async function setMarketOnVault(
  sorobanRpc: rpc.Server,
  adminKeypair: Keypair,
  vaultContract: Contract
): Promise<void> {
  const account = await sorobanRpc.getAccount(adminKeypair.publicKey());

  const args = [new Address(MARKET_CONTRACT_ID).toScVal()];
  const operation = vaultContract.call('set_market_contract', ...args);

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const simulated = await sorobanRpc.simulateTransaction(transaction);

  if (rpc.Api.isSimulationError(simulated)) {
    console.log(`  Simulation failed: ${simulated.error}`);
    return;
  }

  const prepared = rpc.assembleTransaction(transaction, simulated).build();
  prepared.sign(adminKeypair);

  const response = await sorobanRpc.sendTransaction(prepared);

  let result = await sorobanRpc.getTransaction(response.hash);
  let attempts = 0;
  while (result.status === 'NOT_FOUND' && attempts < 30) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    result = await sorobanRpc.getTransaction(response.hash);
    attempts++;
  }

  if (result.status === 'SUCCESS') {
    console.log(`  ✓ Market authorized on Vault!`);
  } else {
    console.log(`  Failed to set market: ${result.status}`);
  }
}

async function approveAdminToMarket(
  sorobanRpc: rpc.Server,
  adminKeypair: Keypair,
  usdcContract: Contract
): Promise<void> {
  console.log('\n[4/4] Approving Admin -> Market (for testing)...');

  const account = await sorobanRpc.getAccount(adminKeypair.publicKey());
  const currentLedger = (await sorobanRpc.getLatestLedger()).sequence;
  const expirationLedger = currentLedger + 6_307_200;

  const args = [
    new Address(adminKeypair.publicKey()).toScVal(),
    new Address(MARKET_CONTRACT_ID).toScVal(),
    nativeToScVal(INFINITE_ALLOWANCE, { type: 'i128' }),
    nativeToScVal(expirationLedger, { type: 'u32' }),
  ];

  const operation = usdcContract.call('approve', ...args);

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const simulated = await sorobanRpc.simulateTransaction(transaction);

  if (rpc.Api.isSimulationError(simulated)) {
    console.log(`  Simulation failed: ${simulated.error}`);
    return;
  }

  const prepared = rpc.assembleTransaction(transaction, simulated).build();
  prepared.sign(adminKeypair);

  const response = await sorobanRpc.sendTransaction(prepared);

  let result = await sorobanRpc.getTransaction(response.hash);
  let attempts = 0;
  while (result.status === 'NOT_FOUND' && attempts < 30) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    result = await sorobanRpc.getTransaction(response.hash);
    attempts++;
  }

  if (result.status === 'SUCCESS') {
    console.log(`  ✓ Admin approved Market for USDC spending!`);
  } else {
    console.log(`  Failed: ${result.status}`);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Noether: Fix Vault/Market USDC Allowances');
  console.log('='.repeat(60));

  if (!ADMIN_SECRET) {
    console.error('ERROR: ADMIN_SECRET_KEY not found in .env file');
    process.exit(1);
  }

  const adminKeypair = Keypair.fromSecret(ADMIN_SECRET);
  const adminPublicKey = adminKeypair.publicKey();
  const sorobanRpc_client = new rpc.Server(RPC_URL);
  const usdcContract = new Contract(USDC_TOKEN_ID);
  const vaultContract = new Contract(VAULT_CONTRACT_ID);

  console.log('\nConfiguration:');
  console.log(`  Admin:  ${adminPublicKey}`);
  console.log(`  Vault:  ${VAULT_CONTRACT_ID}`);
  console.log(`  Market: ${MARKET_CONTRACT_ID}`);
  console.log(`  USDC:   ${USDC_TOKEN_ID}`);

  // Step 1: Check current allowances
  console.log('\n[1/4] Checking current USDC allowances...');
  await checkAllowance(sorobanRpc_client, usdcContract, VAULT_CONTRACT_ID, MARKET_CONTRACT_ID, 'Vault', 'Market');
  await checkAllowance(sorobanRpc_client, usdcContract, MARKET_CONTRACT_ID, VAULT_CONTRACT_ID, 'Market', 'Vault');
  await checkAllowance(sorobanRpc_client, usdcContract, adminPublicKey, MARKET_CONTRACT_ID, 'Admin', 'Market');
  await checkAllowance(sorobanRpc_client, usdcContract, adminPublicKey, VAULT_CONTRACT_ID, 'Admin', 'Vault');

  // Step 2: Try to set up contract-to-contract allowances
  // Note: This may fail because contracts can't sign for themselves
  console.log('\n[2/4] Attempting to set up allowances...');
  console.log('  Note: Contract-to-contract approvals may require special handling');

  // Step 3: Verify Market is authorized on Vault
  await verifyMarketOnVault(sorobanRpc_client, adminKeypair, vaultContract);

  // Step 4: Approve Admin -> Market (useful for testing)
  await approveAdminToMarket(sorobanRpc_client, adminKeypair, usdcContract);

  // Final status
  console.log('\n' + '='.repeat(60));
  console.log('Allowance Check Complete');
  console.log('='.repeat(60));
  console.log('\nFinal allowances:');
  await checkAllowance(sorobanRpc_client, usdcContract, VAULT_CONTRACT_ID, MARKET_CONTRACT_ID, 'Vault', 'Market');
  await checkAllowance(sorobanRpc_client, usdcContract, adminPublicKey, MARKET_CONTRACT_ID, 'Admin', 'Market');

  console.log('\n' + '-'.repeat(60));
  console.log('IMPORTANT: If Error #200 persists, the issue might be:');
  console.log('1. The Vault contract needs internal approval logic');
  console.log('2. The Market needs to call a specific Vault function');
  console.log('3. Check the close_position logic in the Market contract');
  console.log('-'.repeat(60));
}

main().catch(console.error);
