/**
 * Script to initialize the Market contract
 *
 * Usage: npx tsx scripts/initialize-market.ts
 */

import {
  Keypair,
  Contract,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Address,
  nativeToScVal,
  xdr,
  rpc,
} from '@stellar/stellar-sdk';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Configuration
const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY;
const MARKET_CONTRACT_ID = process.env.NEXT_PUBLIC_MARKET_ID!;
const VAULT_CONTRACT_ID = process.env.NEXT_PUBLIC_VAULT_ID!;
const ORACLE_ADAPTER_ID = process.env.NEXT_PUBLIC_ORACLE_ADAPTER_ID!;
const USDC_TOKEN_ID = process.env.NEXT_PUBLIC_USDC_TOKEN_ID!;
const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

// Market configuration - matches MarketConfig struct in noether_common/src/types.rs
const MARKET_CONFIG = {
  min_collateral: BigInt(10) * BigInt(10_000_000), // 10 USDC minimum
  max_leverage: 10,
  maintenance_margin_bps: 100, // 1% maintenance margin
  liquidation_fee_bps: 500, // 5% liquidation fee
  trading_fee_bps: 10, // 0.1%
  base_funding_rate_bps: 1, // 0.01% per hour
  max_position_size: BigInt(100_000) * BigInt(10_000_000), // 100,000 USDC max
  max_price_staleness: 60, // 60 seconds
  max_oracle_deviation_bps: 100, // 1%
};

function createMarketConfigScVal(config: typeof MARKET_CONFIG): xdr.ScVal {
  // Fields must be in alphabetical order for Soroban struct matching
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('base_funding_rate_bps'),
      val: nativeToScVal(config.base_funding_rate_bps, { type: 'u32' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('liquidation_fee_bps'),
      val: nativeToScVal(config.liquidation_fee_bps, { type: 'u32' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('maintenance_margin_bps'),
      val: nativeToScVal(config.maintenance_margin_bps, { type: 'u32' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('max_leverage'),
      val: nativeToScVal(config.max_leverage, { type: 'u32' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('max_oracle_deviation_bps'),
      val: nativeToScVal(config.max_oracle_deviation_bps, { type: 'u32' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('max_position_size'),
      val: nativeToScVal(config.max_position_size, { type: 'i128' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('max_price_staleness'),
      val: nativeToScVal(config.max_price_staleness, { type: 'u64' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('min_collateral'),
      val: nativeToScVal(config.min_collateral, { type: 'i128' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('trading_fee_bps'),
      val: nativeToScVal(config.trading_fee_bps, { type: 'u32' }),
    }),
  ]);
}

async function main() {
  console.log('='.repeat(60));
  console.log('Noether: Initialize Market Contract');
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
  const marketContract = new Contract(MARKET_CONTRACT_ID);

  console.log('\nConfiguration:');
  console.log(`  Admin:          ${adminPublicKey}`);
  console.log(`  Market:         ${MARKET_CONTRACT_ID}`);
  console.log(`  Vault:          ${VAULT_CONTRACT_ID}`);
  console.log(`  Oracle Adapter: ${ORACLE_ADAPTER_ID}`);
  console.log(`  USDC Token:     ${USDC_TOKEN_ID}`);
  console.log(`  Max Leverage:   ${MARKET_CONFIG.max_leverage}x`);
  console.log(`  Min Collateral: ${Number(MARKET_CONFIG.min_collateral) / 10_000_000} USDC`);
  console.log(`  Maint Margin:   ${MARKET_CONFIG.maintenance_margin_bps / 100}%`);
  console.log(`  Liq Fee:        ${MARKET_CONFIG.liquidation_fee_bps / 100}%`);
  console.log(`  Trading Fee:    ${MARKET_CONFIG.trading_fee_bps / 100}%`);

  try {
    // Step 1: Get account
    console.log('\n[1/3] Fetching account...');
    const account = await sorobanRpc.getAccount(adminPublicKey);
    console.log(`  Account sequence: ${account.sequenceNumber()}`);

    // Step 2: Build initialization transaction
    console.log('\n[2/3] Building initialization transaction...');

    // initialize(admin, oracle_adapter, vault, usdc_token, config)
    const args = [
      new Address(adminPublicKey).toScVal(),      // admin
      new Address(ORACLE_ADAPTER_ID).toScVal(),   // oracle_adapter
      new Address(VAULT_CONTRACT_ID).toScVal(),   // vault
      new Address(USDC_TOKEN_ID).toScVal(),       // usdc_token
      createMarketConfigScVal(MARKET_CONFIG),     // config
    ];

    const operation = marketContract.call('initialize', ...args);

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
      if (simulated.error.includes('AlreadyInitialized') || simulated.error.includes('#2')) {
        console.log('\n  Market is already initialized! Skipping...');
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
      console.log('SUCCESS! Market contract initialized.');
      console.log('='.repeat(60));
      console.log(`\nMarket ${MARKET_CONTRACT_ID.slice(0, 8)}... is now ready!`);
      console.log(`Vault ${VAULT_CONTRACT_ID.slice(0, 8)}... is connected.`);
      console.log(`Oracle ${ORACLE_ADAPTER_ID.slice(0, 8)}... is connected.`);
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
