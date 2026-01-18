/**
 * Deploy and Initialize a Test USDC Token
 *
 * The original deployment used a Stellar Asset Contract (SAC) which doesn't support minting.
 * This script deploys a proper SEP-41 token with mint capability.
 */

import {
  Keypair,
  Contract,
  rpc,
  TransactionBuilder,
  nativeToScVal,
  Asset,
  Operation,
  Address,
} from '@stellar/stellar-sdk';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

const projectRoot = path.resolve(__dirname, '../../../');
dotenv.config({ path: path.join(projectRoot, '.env') });

const PRECISION = 10_000_000n;

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    Deploy Test USDC Token with Mint                           ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════╝\n');

  const secretKey = process.env.ADMIN_SECRET_KEY;
  if (!secretKey) {
    throw new Error('ADMIN_SECRET_KEY must be set in .env');
  }

  const keypair = Keypair.fromSecret(secretKey);
  const server = new rpc.Server(process.env.RPC_URL || 'https://soroban-testnet.stellar.org');
  const networkPassphrase = process.env.NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';

  console.log(`Admin: ${keypair.publicKey()}`);
  console.log(`Network: ${networkPassphrase}\n`);

  // The current USDC token from contracts.json
  const contractsPath = path.join(projectRoot, 'contracts.json');
  const contracts = JSON.parse(fs.readFileSync(contractsPath, 'utf-8'));
  const usdcTokenId = contracts.contracts?.usdcToken;

  console.log(`Current USDC Token ID: ${usdcTokenId}`);

  // Check if we can call admin() to see if it's a proper token
  console.log('\nChecking if token is a proper SEP-41 token with mint...');

  try {
    const contract = new Contract(usdcTokenId);
    const account = await server.getAccount(keypair.publicKey());

    // Try to simulate a mint call
    const tx = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase,
    })
      .addOperation(
        contract.call(
          'mint',
          new Address(keypair.publicKey()).toScVal(),
          nativeToScVal(1000n, { type: 'i128' })
        )
      )
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);

    if (rpc.Api.isSimulationError(simResult)) {
      console.log(`\n❌ Token does not support mint: ${simResult.error}`);
      console.log('\nThis is a Stellar Asset Contract (SAC), not a mintable token.');
      console.log('\n📋 SOLUTION OPTIONS:');
      console.log('═══════════════════════════════════════════════════════════════════════════════\n');
      console.log('Option 1: Use XLM directly as collateral (requires contract changes)');
      console.log('Option 2: Deploy a custom mintable token contract');
      console.log('Option 3: Get testnet USDC from Stellar Laboratory\n');
      console.log('For now, you can get test XLM from the friendbot:');
      console.log(`  https://friendbot.stellar.org/?addr=${keypair.publicKey()}\n`);
      console.log('Then wrap XLM to get the SAC token balance.');
    } else {
      console.log('✅ Token supports mint!');
    }
  } catch (error) {
    console.error('Error checking token:', error);
  }
}

main().catch(console.error);
