/**
 * Oracle Price Seeding Script
 *
 * Seeds the mock oracle with realistic prices for BTC, ETH, and XLM.
 * This should be run after deployment to populate the oracle with initial data.
 *
 * Usage:
 *   npx ts-node src/seed-oracle.ts           - Seed once
 *   npx ts-node src/seed-oracle.ts --loop    - Continuously update prices
 */

import { Keypair, Contract, rpc, TransactionBuilder, Address, nativeToScVal, scValToNative } from '@stellar/stellar-sdk';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load .env from project root
const projectRoot = path.resolve(__dirname, '../../../');
dotenv.config({ path: path.join(projectRoot, '.env') });

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

const PRECISION = 10_000_000n; // 7 decimals

// Initial prices (can be overridden by fetching from an API)
const INITIAL_PRICES: Record<string, number> = {
  BTC: 97_000,    // $97,000
  ETH: 3_300,     // $3,300
  XLM: 0.45,      // $0.45
  SOL: 200,       // $200
  LINK: 22,       // $22
};

// Load contracts.json for oracle address
function loadContracts(): { mockOracle: string } {
  const contractsPath = path.join(projectRoot, 'contracts.json');
  if (!fs.existsSync(contractsPath)) {
    throw new Error('contracts.json not found. Run deployment first.');
  }
  const contracts = JSON.parse(fs.readFileSync(contractsPath, 'utf-8'));
  return {
    mockOracle: contracts.contracts?.mockOracle || '',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Stellar Client
// ═══════════════════════════════════════════════════════════════════════════

class OracleSeeder {
  private server: rpc.Server;
  private keypair: Keypair;
  private networkPassphrase: string;
  private oracleContractId: string;

  constructor() {
    const secretKey = process.env.ADMIN_SECRET_KEY;
    if (!secretKey) {
      throw new Error('ADMIN_SECRET_KEY must be set in .env');
    }

    const contracts = loadContracts();
    if (!contracts.mockOracle) {
      throw new Error('Mock Oracle contract ID not found in contracts.json');
    }

    this.server = new rpc.Server(
      process.env.RPC_URL || 'https://soroban-testnet.stellar.org'
    );
    this.keypair = Keypair.fromSecret(secretKey);
    this.networkPassphrase = process.env.NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';
    this.oracleContractId = contracts.mockOracle;

    console.log('Oracle Seeder initialized:');
    console.log(`  Admin: ${this.keypair.publicKey()}`);
    console.log(`  Oracle: ${this.oracleContractId}`);
    console.log('');
  }

  /**
   * Convert a price to the contract's precision format
   */
  private toPrecision(price: number): bigint {
    return BigInt(Math.floor(price * Number(PRECISION)));
  }

  /**
   * Set a single price in the oracle
   */
  async setPrice(asset: string, price: number): Promise<void> {
    const contract = new Contract(this.oracleContractId);
    const account = await this.server.getAccount(this.keypair.publicKey());

    const priceScaled = this.toPrecision(price);

    const tx = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          'set_price',
          nativeToScVal(asset, { type: 'symbol' }),
          nativeToScVal(priceScaled, { type: 'i128' })
        )
      )
      .setTimeout(30)
      .build();

    // Simulate
    const simResponse = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simResponse)) {
      throw new Error(`Simulation failed: ${simResponse.error}`);
    }

    // Prepare and sign
    const preparedTx = rpc.assembleTransaction(tx, simResponse).build();
    preparedTx.sign(this.keypair);

    // Submit
    const sendResponse = await this.server.sendTransaction(preparedTx);
    if (sendResponse.status === 'ERROR') {
      throw new Error(`Transaction failed: ${sendResponse.errorResult}`);
    }

    // Wait for confirmation
    let getResponse = await this.server.getTransaction(sendResponse.hash);
    while (getResponse.status === 'NOT_FOUND') {
      await new Promise((r) => setTimeout(r, 1000));
      getResponse = await this.server.getTransaction(sendResponse.hash);
    }

    if (getResponse.status !== 'SUCCESS') {
      throw new Error(`Transaction failed: ${getResponse.status}`);
    }

    console.log(`  ✅ ${asset}: $${price.toLocaleString()} (${priceScaled})`);
  }

  /**
   * Set multiple prices using individual calls (more reliable)
   */
  async setPrices(prices: Record<string, number>): Promise<void> {
    for (const [asset, price] of Object.entries(prices)) {
      await this.setPrice(asset, price);
    }
  }

  /**
   * Get current price from oracle
   */
  async getPrice(asset: string): Promise<{ price: bigint; timestamp: bigint } | null> {
    try {
      const contract = new Contract(this.oracleContractId);
      const account = await this.server.getAccount(this.keypair.publicKey());

      const tx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call('lastprice', nativeToScVal(asset, { type: 'symbol' }))
        )
        .setTimeout(30)
        .build();

      const simResponse = await this.server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(simResponse)) {
        return null;
      }

      if (!simResponse.result) {
        return null;
      }

      const [price, timestamp] = scValToNative(simResponse.result.retval) as [bigint, bigint];
      return { price, timestamp };
    } catch {
      return null;
    }
  }

  /**
   * Verify all prices are set
   */
  async verifyPrices(assets: string[]): Promise<void> {
    console.log('\nVerifying oracle prices:');
    for (const asset of assets) {
      const data = await this.getPrice(asset);
      if (data) {
        const priceFormatted = Number(data.price) / Number(PRECISION);
        console.log(`  ${asset}: $${priceFormatted.toLocaleString()} (timestamp: ${data.timestamp})`);
      } else {
        console.log(`  ${asset}: ❌ Not set`);
      }
    }
  }

  /**
   * Add some random variation to prices (for testing)
   */
  addVariation(prices: Record<string, number>, variationPercent: number = 0.5): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [asset, price] of Object.entries(prices)) {
      const variation = (Math.random() - 0.5) * 2 * (variationPercent / 100);
      result[asset] = price * (1 + variation);
    }
    return result;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Entry Point
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                         Noether Oracle Seeder                                 ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════════╝\n');

  const seeder = new OracleSeeder();
  const loopMode = process.argv.includes('--loop');
  const updateIntervalMs = parseInt(process.env.ORACLE_UPDATE_INTERVAL_MS || '30000', 10);

  if (loopMode) {
    console.log(`Running in loop mode. Updating every ${updateIntervalMs / 1000}s\n`);
    console.log('Press Ctrl+C to stop.\n');

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down oracle seeder...');
      process.exit(0);
    });

    let iteration = 0;
    while (true) {
      iteration++;
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] Update #${iteration}`);

      // Add small random variation to simulate market movement
      const prices = seeder.addVariation(INITIAL_PRICES, 0.3);

      try {
        await seeder.setPrices(prices);
      } catch (error) {
        console.error('  ❌ Error updating prices:', error);
      }

      await new Promise((r) => setTimeout(r, updateIntervalMs));
      console.log('');
    }
  } else {
    // One-time seed
    console.log('Seeding initial prices...\n');

    try {
      await seeder.setPrices(INITIAL_PRICES);
      console.log('\n✅ Oracle seeded successfully!');

      // Verify
      await seeder.verifyPrices(Object.keys(INITIAL_PRICES));
    } catch (error) {
      console.error('❌ Failed to seed oracle:', error);
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
