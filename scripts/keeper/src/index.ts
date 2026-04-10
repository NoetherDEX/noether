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
  private oracleUpdateInProgress: boolean = false;
  private currentPrices: Map<string, PriceData> = new Map();
  private knownCrossTraders: Set<string> = new Set();
  private lastCrossTraderScan: number = 0;

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

    // 1. Update oracle prices (every oracleUpdateIntervalMs) - await to ensure completion
    if (now - this.lastOracleUpdate >= this.config.oracleUpdateIntervalMs && !this.oracleUpdateInProgress) {
      this.lastOracleUpdate = now;
      this.oracleUpdateInProgress = true;
      try {
        await this.updateOraclePrices();
      } catch (e) {
        console.error('\n❌ Oracle update cycle error:', e);
      } finally {
        this.oracleUpdateInProgress = false;
      }
    }

    // 2. Check and execute liquidations (isolated + cross-margin)
    await this.checkLiquidations();
    await this.checkCrossMarginLiquidations();

    // 3. Update trailing stop peaks + check and execute orders
    await this.updateTrailingStopPeaks();
    await this.checkOrders();

    // 4. Apply funding rate (every hour)
    const ONE_HOUR = 60 * 60 * 1000;
    if (now - this.lastFundingApplication >= ONE_HOUR) {
      try {
        await this.applyFundingRate();
        // Only update timestamp on success or "not yet time" (so we don't skip an hour on transient failure)
        this.lastFundingApplication = now;
      } catch (e) {
        console.error('Funding rate error:', e);
        // Don't update timestamp — retry next cycle
      }
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
   * Fetch prices and update oracle.
   * Primary: Reflector on-chain oracle (real decentralized prices)
   * Fallback: Binance API (if Reflector unavailable)
   */
  private async updateOraclePrices(): Promise<void> {
    try {
      // Try Reflector first (on-chain oracle), fallback to Binance with retry
      let prices = new Map<string, number>();
      let source = 'Reflector';

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          prices = await this.fetchReflectorPrices();
          if (prices.size > 0) {
            source = 'Reflector';
            break;
          }
          prices = await this.fetchBinancePrices();
          if (prices.size > 0) {
            source = 'Binance';
            break;
          }
        } catch (e) {
          if (attempt === 3) {
            console.error(`\n⚠️  All price fetch attempts failed:`, e);
            return;
          }
          await this.sleep(2000);
        }
      }

      for (const asset of this.config.assets) {
        const price = prices.get(asset.symbol);
        if (price === undefined) continue;

        // Validate price sanity
        if (price <= 0 || !isFinite(price)) {
          console.warn(`\n⚠️  Invalid price for ${asset.symbol}: ${price} — skipping`);
          continue;
        }

        // Sanity bounds: reject obviously wrong prices
        const lastPrice = this.currentPrices.get(asset.symbol);
        if (lastPrice && lastPrice.price > 0) {
          const changePercent = Math.abs(price - lastPrice.price) / lastPrice.price;
          if (changePercent > 0.5) {
            console.warn(`\n⚠️  ${asset.symbol} price changed ${(changePercent * 100).toFixed(1)}% ($${lastPrice.price} → $${price}) — skipping (>50% change)`);
            continue;
          }
        }

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
            if (this.stats.oracleUpdates <= 3 || this.stats.oracleUpdates % 50 === 0) {
              console.log(`\n✅ Oracle ${asset.symbol} = $${price.toLocaleString()} (tx: ${result.txHash?.slice(0,8)}...)`);
            }
          } else {
            console.log(`\n⚠️  Oracle update FAILED for ${asset.symbol}: ${result.error}`);
          }
        } catch (error) {
          console.error(`\n❌ Oracle update ERROR for ${asset.symbol}:`, error instanceof Error ? error.message : error);
        }

        // Delay between assets to avoid sequence conflicts
        await this.sleep(4000);
      }

      if (prices.size > 0 && this.stats.oracleUpdates % 10 === 1) {
        console.log(`\n📡 Prices from ${source}`);
      }
    } catch (error) {
      console.error('\nError updating oracle prices:', error);
    }
  }

  /**
   * Fetch prices from Reflector on-chain oracle (testnet)
   * Reflector is a decentralized oracle used by Blend, Slender, OrbitCDP etc.
   * Uses SEP-40 interface with 14 decimal precision
   */
  private async fetchReflectorPrices(): Promise<Map<string, number>> {
    const prices = new Map<string, number>();
    const REFLECTOR_DECIMALS = 14;

    try {
      for (const asset of this.config.assets) {
        try {
          const result = await this.stellar.getReflectorPrice(asset.symbol);
          if (result) {
            const price = Number(result.price) / (10 ** REFLECTOR_DECIMALS);
            if (price > 0) {
              prices.set(asset.symbol, price);
            }
          }
        } catch {
          // Individual asset failure, continue with others
        }
      }
    } catch {
      // Reflector unavailable, will fallback to Binance
    }

    return prices;
  }

  /**
   * Fetch current prices from Binance (fallback)
   */
  private async fetchBinancePrices(): Promise<Map<string, number>> {
    const symbols = this.config.assets.map(a => a.binanceSymbol);
    const url = `https://api.binance.com/api/v3/ticker/price?symbols=${JSON.stringify(symbols)}`;

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
        // Skip cross-margin positions — they use account-level liquidation
        const pos = await this.stellar.getPosition(positionId);
        if (pos && pos.margin_mode === 1) continue;

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
  // Cross-Margin Liquidations
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Check cross-margin accounts for liquidation.
   * Scans all positions to find unique cross-margin traders, then checks each.
   */
  private async checkCrossMarginLiquidations(): Promise<void> {
    try {
      const now = Date.now();
      const CROSS_SCAN_INTERVAL = 60_000; // Full scan every 60s, use cache between

      if (now - this.lastCrossTraderScan >= CROSS_SCAN_INTERVAL) {
        const positionIds = await this.stellar.getAllPositionIds();
        this.knownCrossTraders.clear();

        for (const pid of positionIds) {
          const pos = await this.stellar.getPosition(pid);
          if (pos && pos.margin_mode === 1) {
            this.knownCrossTraders.add(pos.trader);
          }
        }
        this.lastCrossTraderScan = now;
      }

      for (const trader of this.knownCrossTraders) {
        try {
          // is_cross_liquidatable was removed for WASM size.
          // Instead, attempt liquidation directly - contract rejects with
          // CrossMarginNotLiquidatable (#78) if account is healthy.
          const result = await this.stellar.liquidateCrossAccount(trader);
          if (result.success) {
            this.stats.liquidationsExecuted++;
            if (result.reward) this.stats.totalRewardsEarned += result.reward;
            console.log(`\n⚠️  Cross-margin account ${trader.slice(0, 8)}... liquidated!`);
            console.log(`   ✅ Reward: ${this.formatAmount(result.reward || BigInt(0))} USDC`);
          }
          // If result.error contains CrossMarginNotLiquidatable (#78), account is healthy - silent skip
        } catch (error) {
          // Account healthy or other error - ignore
        }
      }
    } catch (error) {
      // No cross-margin accounts, ignore
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Trailing Stop Peak Updates
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Update trailing stop peak prices for all active trailing stop orders.
   */
  private async updateTrailingStopPeaks(): Promise<void> {
    try {
      const orderIds = await this.stellar.getAllOrderIds();

      for (const orderId of orderIds) {
        const order = await this.stellar.getOrder(orderId);
        if (order && order.order_type === 'TrailingStop' && order.status === 'Pending') {
          try {
            await this.stellar.updateTrailingPeak(orderId);
          } catch (error) {
            // Ignore individual peak update errors
          }
        }
      }
    } catch (error) {
      // Ignore errors
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
      // Check if order was cancelled due to slippage or StopLimit phase transition (reward = 0)
      if (result.reward === BigInt(0)) {
        if (orderType === 'StopLimit') {
          console.log(`   🔄 StopLimit order ${orderId} stop triggered → limit phase active`);
        } else {
          this.stats.ordersCancelledSlippage++;
          console.log(`   ⚠️  Order ${orderId} cancelled due to slippage exceeded (collateral refunded)`);
        }
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
    return `${whole}.${fraction.toString().padStart(decimals, '0').slice(0, 4)}`;
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
