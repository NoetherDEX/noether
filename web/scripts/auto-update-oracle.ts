/**
 * Auto Oracle Price Updater
 *
 * Automatically fetches live prices from Binance and updates the mock oracle
 * every 10 seconds for BTC, ETH, and XLM.
 *
 * Features:
 * - Retry logic (up to 3 retries per asset)
 * - Continues updating other assets even if one fails
 * - Delay between assets to avoid sequence number conflicts
 *
 * Usage: npx tsx scripts/auto-update-oracle.ts
 */

import {
  Keypair,
  Contract,
  TransactionBuilder,
  Networks,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Configuration
// Use dedicated ORACLE_SECRET_KEY to avoid conflicts with faucet operations
const ORACLE_SECRET = process.env.ORACLE_SECRET_KEY || process.env.ADMIN_SECRET_KEY;
const MOCK_ORACLE_ID = process.env.NEXT_PUBLIC_MOCK_ORACLE_ID!;
const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

const PRECISION = BigInt(10_000_000); // 7 decimals
const UPDATE_INTERVAL_MS = 10_000; // 10 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000; // 2 seconds between retries
const ASSET_DELAY_MS = 1500; // 1.5 seconds between assets to avoid sequence conflicts

// Assets to update
const ASSETS = ['BTC', 'ETH', 'XLM'] as const;

// Binance symbol mapping
const BINANCE_SYMBOLS: Record<string, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  XLM: 'XLMUSDT',
};

interface BinancePrice {
  symbol: string;
  price: string;
}

interface UpdateResult {
  asset: string;
  success: boolean;
  price?: number;
  error?: string;
  retries: number;
}

/**
 * Fetch live prices from Binance API
 */
async function fetchPricesFromBinance(): Promise<Record<string, number>> {
  const symbols = Object.values(BINANCE_SYMBOLS);
  const url = `https://api.binance.com/api/v3/ticker/price?symbols=${JSON.stringify(symbols)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const data: BinancePrice[] = await response.json();
    const prices: Record<string, number> = {};

    for (const [asset, symbol] of Object.entries(BINANCE_SYMBOLS)) {
      const priceData = data.find((p) => p.symbol === symbol);
      if (priceData) {
        prices[asset] = parseFloat(priceData.price);
      }
    }

    return prices;
  } catch (error) {
    console.error('Failed to fetch from Binance:', error);
    throw error;
  }
}

/**
 * Convert price to contract precision (7 decimals)
 */
function toPrecision(price: number): bigint {
  return BigInt(Math.floor(price * Number(PRECISION)));
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Update a single asset price on the oracle with retry logic
 */
async function updatePriceWithRetry(
  sorobanRpc: rpc.Server,
  oracleContract: Contract,
  oracleKeypair: Keypair,
  asset: string,
  price: number
): Promise<UpdateResult> {
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const account = await sorobanRpc.getAccount(oracleKeypair.publicKey());
      const priceScaled = toPrecision(price);

      const tx = new TransactionBuilder(account, {
        fee: '100000',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          oracleContract.call(
            'set_price',
            nativeToScVal(asset, { type: 'symbol' }),
            nativeToScVal(priceScaled, { type: 'i128' })
          )
        )
        .setTimeout(30)
        .build();

      // Simulate
      const simResponse = await sorobanRpc.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(simResponse)) {
        lastError = `Simulation failed: ${simResponse.error}`;
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        return { asset, success: false, error: lastError, retries: attempt };
      }

      // Prepare and sign
      const preparedTx = rpc.assembleTransaction(tx, simResponse).build();
      preparedTx.sign(oracleKeypair);

      // Submit
      const sendResponse = await sorobanRpc.sendTransaction(preparedTx);
      if (sendResponse.status === 'ERROR') {
        lastError = `Send failed: ${sendResponse.errorResult}`;
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        return { asset, success: false, error: lastError, retries: attempt };
      }

      // Wait for confirmation with extended timeout
      let getResponse = await sorobanRpc.getTransaction(sendResponse.hash);
      let pollAttempts = 0;
      const maxPollAttempts = 15; // 15 attempts * 1 second = 15 seconds max wait

      while (
        getResponse.status === 'NOT_FOUND' &&
        pollAttempts < maxPollAttempts
      ) {
        await sleep(1000);
        getResponse = await sorobanRpc.getTransaction(sendResponse.hash);
        pollAttempts++;
      }

      if (getResponse.status === 'SUCCESS') {
        return { asset, success: true, price, retries: attempt };
      }

      lastError = `Transaction status: ${getResponse.status}`;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      return { asset, success: false, error: lastError, retries: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      return { asset, success: false, error: lastError, retries: attempt };
    }
  }

  return { asset, success: false, error: lastError, retries: MAX_RETRIES };
}

/**
 * Update all asset prices with proper sequencing
 */
async function updateAllPrices(
  sorobanRpc: rpc.Server,
  oracleContract: Contract,
  oracleKeypair: Keypair
): Promise<void> {
  const timestamp = new Date().toLocaleTimeString();
  const results: UpdateResult[] = [];

  try {
    // Fetch live prices
    const prices = await fetchPricesFromBinance();

    console.log(`[${timestamp}] Updating prices...`);

    // Update each asset sequentially with delay between them
    for (let i = 0; i < ASSETS.length; i++) {
      const asset = ASSETS[i];
      const price = prices[asset];

      if (price !== undefined) {
        const result = await updatePriceWithRetry(
          sorobanRpc,
          oracleContract,
          oracleKeypair,
          asset,
          price
        );
        results.push(result);

        if (result.success) {
          const priceStr = price.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: asset === 'XLM' ? 4 : 2,
          });
          const retryInfo = result.retries > 1 ? ` (retry ${result.retries})` : '';
          console.log(`  ✓ ${asset}: $${priceStr}${retryInfo}`);
        } else {
          console.log(`  ✗ ${asset}: FAILED after ${result.retries} attempts - ${result.error}`);
        }

        // Add delay before next asset (except for last one)
        if (i < ASSETS.length - 1) {
          await sleep(ASSET_DELAY_MS);
        }
      }
    }

    // Summary
    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    if (failCount > 0) {
      console.log(`  Summary: ${successCount}/${ASSETS.length} succeeded, ${failCount} failed\n`);
    } else {
      console.log(`  Done! (${successCount}/${ASSETS.length})\n`);
    }
  } catch (error) {
    console.error(`[${timestamp}] Error fetching prices:`, error);
  }
}

async function main() {
  console.log('');
  console.log('═'.repeat(50));
  console.log('  Noether Auto Oracle Price Updater');
  console.log('═'.repeat(50));
  console.log('');

  // Validate environment
  if (!ORACLE_SECRET) {
    console.error('ERROR: ORACLE_SECRET_KEY (or ADMIN_SECRET_KEY) not found in .env file');
    process.exit(1);
  }

  if (!MOCK_ORACLE_ID) {
    console.error('ERROR: NEXT_PUBLIC_MOCK_ORACLE_ID not found in .env file');
    process.exit(1);
  }

  // Setup
  const oracleKeypair = Keypair.fromSecret(ORACLE_SECRET);
  const sorobanRpc = new rpc.Server(RPC_URL);
  const oracleContract = new Contract(MOCK_ORACLE_ID);

  console.log(`Account:    ${oracleKeypair.publicKey().slice(0, 8)}...`);
  console.log(`Contract:   ${MOCK_ORACLE_ID.slice(0, 8)}...`);
  console.log(`Interval:   ${UPDATE_INTERVAL_MS / 1000} seconds`);
  console.log(`Assets:     ${ASSETS.join(', ')}`);
  console.log(`Max Retry:  ${MAX_RETRIES} attempts per asset`);
  console.log(`Source:     Binance API`);
  console.log('');
  console.log('Press Ctrl+C to stop.\n');

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nStopping auto oracle updater...');
    process.exit(0);
  });

  // Initial update
  await updateAllPrices(sorobanRpc, oracleContract, oracleKeypair);

  // Start interval
  setInterval(async () => {
    await updateAllPrices(sorobanRpc, oracleContract, oracleKeypair);
  }, UPDATE_INTERVAL_MS);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
