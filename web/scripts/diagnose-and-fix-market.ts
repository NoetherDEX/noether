/**
 * Diagnose and Fix Market Contract USDC Liquidity
 *
 * This script addresses Error #200 on close_position by:
 * 1. Diagnosing USDC balances across all contracts
 * 2. Seeding the Market contract with USDC liquidity
 *
 * ROOT CAUSE: The Vault's settle_pnl() function only updates accounting,
 * it doesn't actually transfer USDC. When a trader wins (positive PnL),
 * the Market needs to pay out more than it received as collateral,
 * but it doesn't have the extra funds.
 *
 * TEMPORARY FIX: Seed Market with USDC so it can pay winning traders.
 * PERMANENT FIX: Modify Vault contract to transfer USDC in settle_pnl.
 *
 * Usage: npx tsx scripts/diagnose-and-fix-market.ts
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

// Amount to seed Market with (10,000 USDC)
const SEED_AMOUNT = BigInt(10_000) * BigInt(10_000_000); // 10k USDC with 7 decimals

async function getBalance(
  sorobanRpc: rpc.Server,
  usdcContract: Contract,
  address: string,
  label: string
): Promise<bigint> {
  try {
    // Need a source account for simulation
    const dummyKeypair = ADMIN_SECRET ? Keypair.fromSecret(ADMIN_SECRET) : null;
    if (!dummyKeypair) {
      console.log(`  ${label}: Unable to check (no admin key)`);
      return BigInt(0);
    }

    const account = await sorobanRpc.getAccount(dummyKeypair.publicKey());
    const args = [new Address(address).toScVal()];
    const operation = usdcContract.call('balance', ...args);

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const result = await sorobanRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      const balance = scValToNative(result.result.retval) as bigint;
      const formatted = Number(balance) / 10_000_000;
      console.log(`  ${label}: ${formatted.toFixed(2)} USDC (${balance.toString()} raw)`);
      return balance;
    }
    console.log(`  ${label}: 0 USDC (no data)`);
    return BigInt(0);
  } catch (error) {
    console.log(`  ${label}: Error - ${error}`);
    return BigInt(0);
  }
}

async function transferUSDC(
  sorobanRpc: rpc.Server,
  adminKeypair: Keypair,
  usdcContract: Contract,
  toAddress: string,
  amount: bigint,
  label: string
): Promise<boolean> {
  console.log(`\n  Transferring ${Number(amount) / 10_000_000} USDC to ${label}...`);

  try {
    const account = await sorobanRpc.getAccount(adminKeypair.publicKey());
    const args = [
      new Address(adminKeypair.publicKey()).toScVal(),
      new Address(toAddress).toScVal(),
      nativeToScVal(amount, { type: 'i128' }),
    ];

    const operation = usdcContract.call('transfer', ...args);

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
      return false;
    }

    const prepared = rpc.assembleTransaction(transaction, simulated).build();
    prepared.sign(adminKeypair);

    const response = await sorobanRpc.sendTransaction(prepared);

    if (response.status === 'ERROR') {
      console.log(`  Transaction failed`);
      return false;
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
      console.log(`  Transfer successful!`);
      return true;
    } else {
      console.log(`  Transfer failed: ${result.status}`);
      return false;
    }
  } catch (error) {
    console.log(`  Transfer error: ${error}`);
    return false;
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('Noether: Diagnose and Fix Market Contract USDC Liquidity');
  console.log('='.repeat(70));

  if (!ADMIN_SECRET) {
    console.error('ERROR: ADMIN_SECRET_KEY not found in .env file');
    process.exit(1);
  }

  const adminKeypair = Keypair.fromSecret(ADMIN_SECRET);
  const adminPublicKey = adminKeypair.publicKey();
  const sorobanRpc_client = new rpc.Server(RPC_URL);
  const usdcContract = new Contract(USDC_TOKEN_ID);

  console.log('\nConfiguration:');
  console.log(`  Admin:  ${adminPublicKey}`);
  console.log(`  Vault:  ${VAULT_CONTRACT_ID}`);
  console.log(`  Market: ${MARKET_CONTRACT_ID}`);
  console.log(`  USDC:   ${USDC_TOKEN_ID}`);

  // Step 1: Diagnose current balances
  console.log('\n' + '─'.repeat(70));
  console.log('[1/3] DIAGNOSING USDC BALANCES');
  console.log('─'.repeat(70));

  const adminBalance = await getBalance(sorobanRpc_client, usdcContract, adminPublicKey, 'Admin');
  const vaultBalance = await getBalance(sorobanRpc_client, usdcContract, VAULT_CONTRACT_ID, 'Vault');
  const marketBalance = await getBalance(sorobanRpc_client, usdcContract, MARKET_CONTRACT_ID, 'Market');

  // Step 2: Analyze the problem
  console.log('\n' + '─'.repeat(70));
  console.log('[2/3] ANALYSIS');
  console.log('─'.repeat(70));

  const marketBalanceUSDC = Number(marketBalance) / 10_000_000;
  const vaultBalanceUSDC = Number(vaultBalance) / 10_000_000;

  if (marketBalanceUSDC < 100) {
    console.log('\n  PROBLEM DETECTED: Market contract has insufficient USDC!');
    console.log('  ─────────────────────────────────────────────────────────');
    console.log('  When traders close winning positions, the Market needs to pay out:');
    console.log('    collateral + profit');
    console.log('  But Market only has the original collateral deposited.');
    console.log('  The profit should come from the Vault, but settle_pnl()');
    console.log('  only updates accounting - it does NOT transfer USDC.');
    console.log('');
    console.log('  TEMPORARY FIX: Seed Market with USDC liquidity');
    console.log('  PERMANENT FIX: Modify Vault contract to transfer funds in settle_pnl');
  } else {
    console.log(`\n  Market has ${marketBalanceUSDC.toFixed(2)} USDC`);
    console.log('  This should be enough for small trades.');
  }

  // Step 3: Seed Market if needed and admin has funds
  console.log('\n' + '─'.repeat(70));
  console.log('[3/3] APPLYING FIX');
  console.log('─'.repeat(70));

  const adminBalanceUSDC = Number(adminBalance) / 10_000_000;
  const seedAmountUSDC = Number(SEED_AMOUNT) / 10_000_000;

  if (marketBalanceUSDC >= 1000) {
    console.log('\n  Market already has sufficient liquidity. No action needed.');
  } else if (adminBalanceUSDC < seedAmountUSDC) {
    console.log(`\n  Admin balance (${adminBalanceUSDC.toFixed(2)} USDC) is too low.`);
    console.log(`  Need at least ${seedAmountUSDC.toFixed(2)} USDC to seed Market.`);
    console.log('  Please fund the admin account with testnet USDC first.');
    console.log('');
    console.log('  You can get testnet USDC from:');
    console.log('  https://laboratory.stellar.org/#account-creator?network=test');
  } else {
    console.log(`\n  Seeding Market with ${seedAmountUSDC.toFixed(2)} USDC...`);
    const success = await transferUSDC(
      sorobanRpc_client,
      adminKeypair,
      usdcContract,
      MARKET_CONTRACT_ID,
      SEED_AMOUNT,
      'Market Contract'
    );

    if (success) {
      // Verify new balance
      console.log('\n  Verifying new Market balance...');
      await getBalance(sorobanRpc_client, usdcContract, MARKET_CONTRACT_ID, 'Market (after)');
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('SUMMARY');
  console.log('═'.repeat(70));
  console.log(`
The Error #200 on close_position is caused by the Market contract not
having enough USDC to pay out winning traders.

CURRENT ARCHITECTURE ISSUE:
  1. Trader opens position: collateral goes to Market
  2. Trader closes with profit: Market calls Vault.settle_pnl(pnl)
  3. Vault.settle_pnl() only updates internal accounting (total_usdc counter)
  4. Vault does NOT actually transfer USDC to Market
  5. Market tries to pay trader (collateral + profit)
  6. Market doesn't have enough USDC -> Error #200

TEMPORARY FIX (applied above):
  Seed Market contract with USDC so it has liquidity to pay winners.
  This works for testing but is not sustainable.

PERMANENT FIX (requires contract modification):
  Modify Vault.settle_pnl() to actually transfer USDC:

  pub fn settle_pnl(env: Env, pnl: i128) -> Result<(), NoetherError> {
      // ... existing auth code ...

      let usdc_token = get_usdc_token(&env);
      let token_client = token::Client::new(&env, &usdc_token);

      if pnl > 0 {
          // Trader won - Vault pays Market
          token_client.transfer(
              &env.current_contract_address(),  // from: Vault
              &market_contract,                 // to: Market
              &pnl
          );
          set_total_usdc(&env, total_usdc - pnl);
      } else {
          // Trader lost - Market pays Vault
          token_client.transfer(
              &market_contract,                 // from: Market (needs auth)
              &env.current_contract_address(),  // to: Vault
              &(-pnl)
          );
          set_total_usdc(&env, total_usdc + (-pnl));
      }
      Ok(())
  }

  This requires redeploying the Vault contract.
`);
  console.log('─'.repeat(70));
}

main().catch(console.error);
