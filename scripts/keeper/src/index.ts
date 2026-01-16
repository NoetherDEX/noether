/**
 * Noether Keeper Bot
 *
 * Monitors positions and executes liquidations for underwater positions.
 * Earns rewards (typically 5% of remaining collateral) for each liquidation.
 *
 * Usage:
 *   npm start        - Start the keeper bot
 *   npm run dev      - Start with auto-reload
 */

import { loadConfig, KeeperConfig } from './config';
import { StellarClient } from './stellar';

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
║                         Liquidation Keeper Bot                                ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`;

interface Position {
  id: bigint;
  trader: string;
  asset: string;
  collateral: bigint;
  size: bigint;
  entryPrice: bigint;
  direction: 'Long' | 'Short';
  leverage: number;
  liquidationPrice: bigint;
}

class KeeperBot {
  private config: KeeperConfig;
  private stellar: StellarClient;
  private isRunning: boolean = false;
  private liquidationCount: number = 0;
  private totalRewards: bigint = BigInt(0);

  constructor() {
    this.config = loadConfig();
    this.stellar = new StellarClient(this.config);
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
      console.error('   Run the deployment script first: ./scripts/setup_and_deploy.sh');
      process.exit(1);
    }

    console.log('Configuration:');
    console.log(`  Network:          ${this.config.network}`);
    console.log(`  RPC URL:          ${this.config.rpcUrl}`);
    console.log(`  Keeper Address:   ${this.stellar.publicKey}`);
    console.log(`  Market Contract:  ${this.config.marketContractId}`);
    console.log(`  Oracle Contract:  ${this.config.oracleContractId}`);
    console.log(`  Poll Interval:    ${this.config.pollIntervalMs}ms`);
    console.log('');

    this.isRunning = true;

    // Handle graceful shutdown
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());

    console.log('🚀 Keeper bot started. Monitoring positions...\n');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    // Main loop
    while (this.isRunning) {
      try {
        await this.checkAndLiquidate();
      } catch (error) {
        console.error('Error in keeper loop:', error);
      }

      await this.sleep(this.config.pollIntervalMs);
    }
  }

  /**
   * Stop the keeper bot
   */
  stop(): void {
    console.log('\n\n═══════════════════════════════════════════════════════════════════════════════');
    console.log('Shutting down keeper bot...');
    console.log(`Total liquidations: ${this.liquidationCount}`);
    console.log(`Total rewards earned: ${this.formatAmount(this.totalRewards)} USDC`);
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');
    this.isRunning = false;
    process.exit(0);
  }

  /**
   * Main check and liquidate loop
   */
  private async checkAndLiquidate(): Promise<void> {
    const timestamp = new Date().toISOString();

    // Get all position IDs
    const positionIds = await this.stellar.getAllPositionIds(
      this.config.marketContractId
    );

    if (positionIds.length === 0) {
      process.stdout.write(`[${timestamp}] No open positions                    \r`);
      return;
    }

    process.stdout.write(`[${timestamp}] Checking ${positionIds.length} positions... \r`);

    // Check each position
    for (const positionId of positionIds) {
      try {
        const isLiquidatable = await this.stellar.isLiquidatable(
          this.config.marketContractId,
          positionId
        );

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

    try {
      const txHash = await this.stellar.liquidate(
        this.config.marketContractId,
        positionId
      );

      this.liquidationCount++;
      console.log(`   ✅ Liquidation successful!`);
      console.log(`   Transaction: ${txHash}`);
      console.log(`   Total liquidations: ${this.liquidationCount}\n`);
    } catch (error: any) {
      console.error(`   ❌ Liquidation failed: ${error.message}\n`);
    }
  }

  /**
   * Format amount with decimals
   */
  private formatAmount(amount: bigint, decimals: number = 7): string {
    const divisor = BigInt(10 ** decimals);
    const whole = amount / divisor;
    const fraction = amount % divisor;
    return `${whole}.${fraction.toString().padStart(decimals, '0').slice(0, 2)}`;
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
