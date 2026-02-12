/**
 * Noether Keeper Bot
 *
 * A unified keeper bot that handles:
 * 1. Oracle price updates (fetches from Binance, updates mock oracle)
 * 2. Position liquidations (monitors positions, liquidates when underwater)
 * 3. Order executions (limit orders, stop-loss, take-profit)
 * 4. Funding rate application (hourly)
 *
 * Usage:
 *   npm start        - Start the keeper bot
 *   npm run dev      - Start with auto-reload
 */

import { loadConfig } from './config';
import { StellarClient } from './stellar';
import { KeeperConfig, KeeperStats, PriceData, AssetConfig } from './types';

// ASCII art banner
const BANNER = `
╔═══════════════════════════════════════════════════════════════════════════════╗
║                                                                               ║
║     _   _            _   _                 _  __                              ║
║    | \\ | | ___   ___| |_| |__   ___ _ __  | |/ /___  ___ _ __   ___ _ __      ║
║    |  \\| |/ _ \\ / _ \\ __| '_ \\ / _ \\ '__| | ' // _ \\/ _ \\ '_ \\ / _ \\ '__|     ║
║    | |\\  | (_) |  __/ |_| | | |  __/ |    | . \\  __/  __/ |_) |  __/ |        ║
║    |_| \\_|\\___/ \\___|\\__|_| |_|\\___|_|    |_|\\_\\___|\\___| .__/ \\___|_|        ║
║                                                         |_|                   ║
║                     Unified Keeper Bot v2.0                                   ║
║           Oracle Updates | Liquidations | Order Execution                     ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`;

const PRECISION = BigInt(10_000_000); // 7 decimals

class KeeperBot {
  private config: KeeperConfig;
  private stellar: StellarClient;
  private isRunning: boolean = false;
  private stats: KeeperStats;
  private lastOracleUpdate: number = 0;
  private lastFundingApplication: number = 0;
  private currentPrices: Map<string, PriceData> = new Map();

  constructor() {
    this.config = loadConfig();
    this.stellar = new StellarClient(this.config);
    this.stats = {
      startTime: new Date(),
      oracleUpdates: 0,
      liquidationsExecuted: 0,
      ordersExecuted: 0,
      ordersCancelledSlippage: 0,
      ordersSkippedOrphaned: 0,
      totalRewardsEarned: BigInt(0),
      errors: 0,
    };
  }

  /**
   * Start the keeper bot
   */
  async start(): Promise<void> {
    console.log(BANNER);
    console.log('Starting Noether Keeper Bot...\n');

    // Validate configuration
    if (!this.config.marketContractId) {
      console.error('❌ Market contract ID not configured.');
      console.error('   Set NEXT_PUBLIC_MARKET_ID in .env or deploy contracts first.');
      process.exit(1);
    }

    if (!this.config.oracleContractId) {
      console.error('❌ Oracle contract ID not configured.');
      console.error('   Set NEXT_PUBLIC_MOCK_ORACLE_ID in .env or deploy contracts first.');
      process.exit(1);
    }

    console.log('Configuration:');
    console.log(`  Network:           ${this.config.network}`);
    console.log(`  RPC URL:           ${this.config.rpcUrl}`);
    console.log(`  Keeper Address:    ${this.stellar.publicKey}`);
    console.log(`  Market Contract:   ${this.config.marketContractId.slice(0, 8)}...`);
    console.log(`  Oracle Contract:   ${this.config.oracleContractId.slice(0, 8)}...`);
    console.log(`  Poll Interval:     ${this.config.pollIntervalMs}ms`);
    console.log(`  Oracle Interval:   ${this.config.oracleUpdateIntervalMs}ms`);
    console.log(`  Assets:            ${this.config.assets.map(a => a.symbol).join(', ')}`);
    console.log('');

    this.isRunning = true;

    // Handle graceful shutdown
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());

    console.log('🚀 Keeper bot started. Monitoring...\n');
    console.log('═'.repeat(80) + '\n');

    // Main loop
    while (this.isRunning) {
      try {
        await this.runKeeperCycle();
      } catch (error) {
        console.error('Error in keeper loop:', error);
        this.stats.errors++;
      }

      await this.sleep(this.config.pollIntervalMs);
    }
  }

  /**
   * Stop the keeper bot
   */
  stop(): void {
    console.log('\n\n' + '═'.repeat(80));
    console.log('Shutting down keeper bot...\n');
    console.log('Session Statistics:');
    console.log(`  Runtime:               ${this.formatDuration(Date.now() - this.stats.startTime.getTime())}`);
    console.log(`  Oracle Updates:        ${this.stats.oracleUpdates}`);
    console.log(`  Liquidations:          ${this.stats.liquidationsExecuted}`);
    console.log(`  Orders Executed:       ${this.stats.ordersExecuted}`);
    console.log(`  Orders Cancelled:      ${this.stats.ordersCancelledSlippage} (slippage)`);
    console.log(`  Orders Skipped:        ${this.stats.ordersSkippedOrphaned} (orphaned - position closed)`);
    console.log(`  Total Rewards:         ${this.formatAmount(this.stats.totalRewardsEarned)} USDC`);
    console.log(`  Errors:                ${this.stats.errors}`);
    console.log('═'.repeat(80) + '\n');
    this.isRunning = false;
    process.exit(0);
  }

  /**
   * Run a single keeper cycle
   */
  private async runKeeperCycle(): Promise<void> {
    const now = Date.now();
    const timestamp = new Date().toLocaleTimeString();

    // 1. Update oracle prices (every oracleUpdateIntervalMs) - run in background, don't block
    if (now - this.lastOracleUpdate >= this.config.oracleUpdateIntervalMs) {
      this.lastOracleUpdate = now;
      // Run in background without await
      this.updateOraclePrices().catch(e => console.error('Oracle update error:', e));
    }

    // 2. Check and execute liquidations
    await this.checkLiquidations();

    // 3. Check and execute orders
    await this.checkOrders();

    // 4. Apply funding rate (every hour)
    const ONE_HOUR = 60 * 60 * 1000;
    if (now - this.lastFundingApplication >= ONE_HOUR) {
      this.applyFundingRate().catch(e => console.error('Funding rate error:', e));
      this.lastFundingApplication = now;
    }

    // Status line
    const priceStr = this.config.assets
      .map(a => {
        const p = this.currentPrices.get(a.symbol);
        return p ? `${a.symbol}:$${p.price.toLocaleString()}` : '';
      })
      .filter(Boolean)
      .join(' | ');

    process.stdout.write(`\r[${timestamp}] ${priceStr}    `);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Oracle Updates
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Fetch prices from Binance and update oracle
   */
  private async updateOraclePrices(): Promise<void> {
    try {
      const prices = await this.fetchBinancePrices();

      for (const asset of this.config.assets) {
        const price = prices.get(asset.symbol);
        if (price === undefined) continue;

        const priceScaled = this.toPrecision(price);

        try {
          const result = await this.stellar.updateOraclePrice(asset.symbol, priceScaled);

          if (result.success) {
            this.currentPrices.set(asset.symbol, {
              asset: asset.symbol,
              price,
              priceScaled,
              timestamp: Date.now(),
            });
            this.stats.oracleUpdates++;
          } else {
            console.log(`\n⚠️  Oracle update failed for ${asset.symbol}: ${result.error}`);
          }
        } catch (error) {
          console.error(`\nError updating oracle for ${asset.symbol}:`, error);
        }

        // Delay between assets to avoid sequence conflicts
        await this.sleep(1500);
      }
    } catch (error) {
      console.error('\nError fetching Binance prices:', error);
    }
  }

  /**
   * Fetch current prices from Binance
   */
  private async fetchBinancePrices(): Promise<Map<string, number>> {
    const symbols = this.config.assets.map(a => a.binanceSymbol);
    const url = `https://api.binance.us/api/v3/ticker/price?symbols=${JSON.stringify(symbols)}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const data = await response.json() as Array<{ symbol: string; price: string }>;
    const prices = new Map<string, number>();

    for (const asset of this.config.assets) {
      const priceData = data.find(p => p.symbol === asset.binanceSymbol);
      if (priceData) {
        prices.set(asset.symbol, parseFloat(priceData.price));
      }
    }

    return prices;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Liquidations
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Check all positions for liquidation
   */
  private async checkLiquidations(): Promise<void> {
    const positionIds = await this.stellar.getAllPositionIds();

    if (positionIds.length === 0) return;

    for (const positionId of positionIds) {
      try {
        const isLiquidatable = await this.stellar.isLiquidatable(positionId);

        if (isLiquidatable) {
          console.log(`\n⚠️  Position ${positionId} is liquidatable!`);
          await this.executeLiquidation(positionId);
        }
      } catch (error) {
        // Position might have been closed, ignore
      }
    }
  }

  /**
   * Execute a liquidation
   */
  private async executeLiquidation(positionId: bigint): Promise<void> {
    console.log(`   Executing liquidation for position ${positionId}...`);

    const result = await this.stellar.liquidate(positionId);

    if (result.success) {
      this.stats.liquidationsExecuted++;
      if (result.reward) {
        this.stats.totalRewardsEarned += result.reward;
      }
      console.log(`   ✅ Liquidation successful!`);
      console.log(`   Transaction: ${result.txHash}`);
      if (result.reward) {
        console.log(`   Reward: ${this.formatAmount(result.reward)} USDC`);
      }
    } else {
      console.log(`   ❌ Liquidation failed: ${result.error}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Order Execution
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Check all pending orders for execution
   */
  private async checkOrders(): Promise<void> {
    const orderIds = await this.stellar.getAllOrderIds();

    if (orderIds.length === 0) return;

    for (const orderId of orderIds) {
      try {
        const shouldExecute = await this.stellar.shouldExecuteOrder(orderId);

        if (shouldExecute) {
          const order = await this.stellar.getOrder(orderId);
          if (order) {
            console.log(`\n📋 Order ${orderId} triggered! (${order.order_type} ${order.direction} ${order.asset})`);
            await this.executeOrder(orderId, order.order_type);
          }
        }
      } catch (error) {
        // Order might have been cancelled or executed, ignore
      }
    }
  }

  /**
   * Execute a triggered order
   */
  private async executeOrder(orderId: bigint, orderType: string): Promise<void> {
    console.log(`   Executing order ${orderId}...`);

    const result = await this.stellar.executeOrder(orderId);

    if (result.success) {
      // Check if order was cancelled due to slippage (reward = 0)
      if (result.reward === BigInt(0)) {
        this.stats.ordersCancelledSlippage++;
        console.log(`   ⚠️  Order ${orderId} cancelled due to slippage exceeded (collateral refunded)`);
      } else {
        this.stats.ordersExecuted++;
        this.stats.totalRewardsEarned += result.reward!;
        console.log(`   ✅ Order executed successfully!`);
        console.log(`   Transaction: ${result.txHash}`);
        console.log(`   Keeper fee: ${this.formatAmount(result.reward!)} USDC`);
      }
    } else {
      // Handle PositionNotFound (Error #20) for SL/TP orders
      // This happens when the position was already closed (manually, liquidated, or by another SL/TP)
      // The order is orphaned but harmless - just skip it
      if (result.error?.includes('PositionNotFound') || result.error?.includes('#20')) {
        this.stats.ordersSkippedOrphaned++;
        console.log(`   ⚠️  Order ${orderId} skipped: Position already closed (manually or liquidated)`);
        console.log(`      This ${orderType} order is now orphaned and will be ignored.`);
      } else {
        console.log(`   ❌ Order execution failed: ${result.error}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Funding Rate
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Apply funding rate
   */
  private async applyFundingRate(): Promise<void> {
    console.log('\n⏰ Applying hourly funding rate...');

    const result = await this.stellar.applyFunding();

    if (result.success) {
      console.log('   ✅ Funding rate applied');
    } else if (result.error?.includes('FundingIntervalNotElapsed') || result.error?.includes('#55')) {
      // Not yet time, ignore silently
    } else {
      console.log(`   ❌ Funding rate application failed: ${result.error}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Utilities
  // ═══════════════════════════════════════════════════════════════════════

  private toPrecision(price: number): bigint {
    return BigInt(Math.floor(price * Number(PRECISION)));
  }

  private formatAmount(amount: bigint, decimals: number = 7): string {
    const divisor = BigInt(10 ** decimals);
    const whole = amount / divisor;
    const fraction = amount % divisor;
    return `${whole}.${fraction.toString().padStart(decimals, '0').slice(0, 2)}`;
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Entry point
async function main(): Promise<void> {
  const keeper = new KeeperBot();
  await keeper.start();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
