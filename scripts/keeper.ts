/**
 * Noether Liquidation Keeper Bot
 *
 * This script monitors positions on the Noether Market contract
 * and liquidates unhealthy positions to earn liquidation rewards.
 *
 * Usage: npx ts-node scripts/keeper.ts
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import dotenv from "dotenv";

dotenv.config();

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  // Network configuration
  networkPassphrase: StellarSdk.Networks.FUTURENET,
  rpcUrl: process.env.RPC_URL || "https://rpc-futurenet.stellar.org",
  horizonUrl:
    process.env.HORIZON_URL || "https://horizon-futurenet.stellar.org",

  // Contract addresses (set via environment variables)
  marketContractId: process.env.MARKET_CONTRACT_ID || "",
  oracleContractId: process.env.ORACLE_CONTRACT_ID || "",

  // Keeper wallet
  keeperSecretKey: process.env.KEEPER_SECRET_KEY || "",

  // Bot settings
  checkIntervalMs: parseInt(process.env.CHECK_INTERVAL_MS || "10000"), // 10 seconds
  maxRetries: 3,

  // Assets to monitor
  assets: ["Stellar", "USDC"],
};

// ============================================================================
// Types
// ============================================================================

interface Position {
  owner: string;
  asset: string;
  direction: "Long" | "Short";
  collateral: bigint;
  size: bigint;
  entry_price: bigint;
  liquidation_price: bigint;
}

interface LiquidationResult {
  trader: string;
  asset: string;
  reward: bigint;
  success: boolean;
  error?: string;
}

// ============================================================================
// Keeper Bot Class
// ============================================================================

class LiquidationKeeper {
  private server: StellarSdk.SorobanRpc.Server;
  private keypair: StellarSdk.Keypair;
  private isRunning: boolean = false;

  constructor() {
    // Validate configuration
    if (!CONFIG.marketContractId) {
      throw new Error("MARKET_CONTRACT_ID environment variable is required");
    }
    if (!CONFIG.keeperSecretKey) {
      throw new Error("KEEPER_SECRET_KEY environment variable is required");
    }

    this.server = new StellarSdk.SorobanRpc.Server(CONFIG.rpcUrl);
    this.keypair = StellarSdk.Keypair.fromSecret(CONFIG.keeperSecretKey);

    console.log("🤖 Liquidation Keeper initialized");
    console.log(`   Network: ${CONFIG.networkPassphrase}`);
    console.log(`   Market Contract: ${CONFIG.marketContractId}`);
    console.log(`   Keeper Address: ${this.keypair.publicKey()}`);
    console.log(`   Check Interval: ${CONFIG.checkIntervalMs}ms`);
  }

  /**
   * Start the keeper bot
   */
  async start(): Promise<void> {
    this.isRunning = true;
    console.log("\n🚀 Starting liquidation keeper...\n");

    while (this.isRunning) {
      try {
        await this.runLiquidationCycle();
      } catch (error) {
        console.error("❌ Error in liquidation cycle:", error);
      }

      // Wait before next cycle
      await this.sleep(CONFIG.checkIntervalMs);
    }
  }

  /**
   * Stop the keeper bot
   */
  stop(): void {
    this.isRunning = false;
    console.log("\n🛑 Stopping liquidation keeper...");
  }

  /**
   * Run a single liquidation cycle
   */
  private async runLiquidationCycle(): Promise<void> {
    console.log(`\n📊 [${new Date().toISOString()}] Starting liquidation check...`);

    // 1. Fetch active traders
    const activeTraders = await this.getActiveTraders();
    console.log(`   Found ${activeTraders.length} active traders`);

    if (activeTraders.length === 0) {
      console.log("   No active traders to check");
      return;
    }

    // 2. Check each trader's positions
    for (const trader of activeTraders) {
      console.log(`\n   Checking trader: ${trader.substring(0, 8)}...`);

      for (const asset of CONFIG.assets) {
        try {
          // Check if position exists and is liquidatable
          const isLiquidatable = await this.checkIfLiquidatable(trader, asset);

          if (isLiquidatable) {
            console.log(`   ⚠️  Position is liquidatable! Asset: ${asset}`);

            // Attempt liquidation
            const result = await this.liquidatePosition(trader, asset);

            if (result.success) {
              console.log(
                `   ✅ Liquidated! Reward: ${result.reward.toString()} USDC`
              );
            } else {
              console.log(`   ❌ Liquidation failed: ${result.error}`);
            }
          } else {
            console.log(`   ✓ ${asset} position is healthy`);
          }
        } catch (error: any) {
          // Position might not exist for this asset
          if (!error.message?.includes("InvalidInput")) {
            console.log(`   ⚡ Error checking ${asset}: ${error.message}`);
          }
        }
      }
    }
  }

  /**
   * Get list of active traders from the contract
   */
  private async getActiveTraders(): Promise<string[]> {
    try {
      const contract = new StellarSdk.Contract(CONFIG.marketContractId);
      const account = await this.server.getAccount(this.keypair.publicKey());

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: CONFIG.networkPassphrase,
      })
        .addOperation(contract.call("get_active_traders"))
        .setTimeout(30)
        .build();

      const simResult = await this.server.simulateTransaction(tx);

      if (StellarSdk.SorobanRpc.Api.isSimulationSuccess(simResult)) {
        // Parse the result - this will be a Vec<Address>
        const result = simResult.result?.retval;
        if (result) {
          // Convert Soroban Vec to array of addresses
          const scVal = result as StellarSdk.xdr.ScVal;
          return this.parseAddressVec(scVal);
        }
      }

      return [];
    } catch (error) {
      console.error("Error fetching active traders:", error);
      return [];
    }
  }

  /**
   * Check if a position is liquidatable
   */
  private async checkIfLiquidatable(
    trader: string,
    asset: string
  ): Promise<boolean> {
    try {
      const contract = new StellarSdk.Contract(CONFIG.marketContractId);
      const account = await this.server.getAccount(this.keypair.publicKey());

      const assetScVal = this.createAssetScVal(asset);
      const traderScVal = StellarSdk.nativeToScVal(trader, { type: "address" });

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: CONFIG.networkPassphrase,
      })
        .addOperation(contract.call("is_liquidatable", traderScVal, assetScVal))
        .setTimeout(30)
        .build();

      const simResult = await this.server.simulateTransaction(tx);

      if (StellarSdk.SorobanRpc.Api.isSimulationSuccess(simResult)) {
        const result = simResult.result?.retval;
        if (result) {
          return StellarSdk.scValToBigInt(result) !== BigInt(0);
        }
      }

      return false;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Execute liquidation transaction
   */
  private async liquidatePosition(
    trader: string,
    asset: string
  ): Promise<LiquidationResult> {
    try {
      const contract = new StellarSdk.Contract(CONFIG.marketContractId);
      const account = await this.server.getAccount(this.keypair.publicKey());

      const liquidatorScVal = StellarSdk.nativeToScVal(
        this.keypair.publicKey(),
        { type: "address" }
      );
      const traderScVal = StellarSdk.nativeToScVal(trader, { type: "address" });
      const assetScVal = this.createAssetScVal(asset);

      // Build transaction
      let tx = new StellarSdk.TransactionBuilder(account, {
        fee: "100",
        networkPassphrase: CONFIG.networkPassphrase,
      })
        .addOperation(
          contract.call("liquidate", liquidatorScVal, traderScVal, assetScVal)
        )
        .setTimeout(30)
        .build();

      // Simulate to get resource requirements
      const simResult = await this.server.simulateTransaction(tx);

      if (!StellarSdk.SorobanRpc.Api.isSimulationSuccess(simResult)) {
        return {
          trader,
          asset,
          reward: BigInt(0),
          success: false,
          error: "Simulation failed",
        };
      }

      // Prepare transaction with resources
      tx = StellarSdk.SorobanRpc.assembleTransaction(
        tx,
        simResult
      ).build() as StellarSdk.Transaction;

      // Sign transaction
      tx.sign(this.keypair);

      // Submit transaction
      const sendResult = await this.server.sendTransaction(tx);

      if (sendResult.status === "PENDING") {
        // Wait for confirmation
        let getResult = await this.server.getTransaction(sendResult.hash);

        while (getResult.status === "NOT_FOUND") {
          await this.sleep(1000);
          getResult = await this.server.getTransaction(sendResult.hash);
        }

        if (getResult.status === "SUCCESS") {
          // Parse reward from result
          const reward = this.parseRewardFromResult(getResult);
          return {
            trader,
            asset,
            reward,
            success: true,
          };
        } else {
          return {
            trader,
            asset,
            reward: BigInt(0),
            success: false,
            error: `Transaction failed: ${getResult.status}`,
          };
        }
      }

      return {
        trader,
        asset,
        reward: BigInt(0),
        success: false,
        error: `Send failed: ${sendResult.status}`,
      };
    } catch (error: any) {
      return {
        trader,
        asset,
        reward: BigInt(0),
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Create Asset ScVal for contract calls
   */
  private createAssetScVal(asset: string): StellarSdk.xdr.ScVal {
    // Create enum variant for Asset type
    if (asset === "Stellar") {
      return StellarSdk.xdr.ScVal.scvSymbol("Stellar");
    } else if (asset === "USDC") {
      return StellarSdk.xdr.ScVal.scvSymbol("USDC");
    }
    throw new Error(`Unknown asset: ${asset}`);
  }

  /**
   * Parse address vector from ScVal
   */
  private parseAddressVec(scVal: StellarSdk.xdr.ScVal): string[] {
    const addresses: string[] = [];
    if (scVal.switch().name === "scvVec") {
      const vec = scVal.vec();
      if (vec) {
        for (const item of vec) {
          try {
            const addr = StellarSdk.Address.fromScVal(item);
            addresses.push(addr.toString());
          } catch {
            // Skip invalid addresses
          }
        }
      }
    }
    return addresses;
  }

  /**
   * Parse reward amount from transaction result
   */
  private parseRewardFromResult(
    result: StellarSdk.SorobanRpc.Api.GetSuccessfulTransactionResponse
  ): bigint {
    try {
      if (result.returnValue) {
        return StellarSdk.scValToBigInt(result.returnValue);
      }
    } catch {
      // Return 0 if parsing fails
    }
    return BigInt(0);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("           NOETHER LIQUIDATION KEEPER BOT                   ");
  console.log("═══════════════════════════════════════════════════════════");

  const keeper = new LiquidationKeeper();

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    keeper.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    keeper.stop();
    process.exit(0);
  });

  // Start the keeper
  await keeper.start();
}

// Run the bot
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

