/**
 * Noether Keeper Bot - Stellar/Soroban Client
 *
 * Handles all blockchain interactions including:
 * - Oracle price updates
 * - Position queries and liquidations
 * - Order queries and executions
 */

import {
  Keypair,
  Contract,
  rpc,
  TransactionBuilder,
  xdr,
  Address,
  scValToNative,
  nativeToScVal,
  Account,
} from '@stellar/stellar-sdk';
import { KeeperConfig, Position, Order, ExecutionResult } from './types';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const TX_TIMEOUT_SECONDS = 300;

export class StellarClient {
  private server: rpc.Server;
  private keypair: Keypair;
  private networkPassphrase: string;
  private marketContract: Contract;
  private oracleContract: Contract;

  constructor(private config: KeeperConfig) {
    this.server = new rpc.Server(config.rpcUrl);
    this.keypair = Keypair.fromSecret(config.secretKey);
    this.networkPassphrase = config.networkPassphrase;
    this.marketContract = new Contract(config.marketContractId);
    this.oracleContract = new Contract(config.oracleContractId);
  }

  get publicKey(): string {
    return this.keypair.publicKey();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Account Management
  // ═══════════════════════════════════════════════════════════════════════

  async getAccount(): Promise<Account> {
    return this.server.getAccount(this.keypair.publicKey());
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Oracle Functions
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Update oracle price for an asset
   */
  async updateOraclePrice(asset: string, priceScaled: bigint): Promise<ExecutionResult> {
    return this.invokeContractWriteWithRetry(
      this.oracleContract,
      'set_price',
      [
        nativeToScVal(asset, { type: 'symbol' }),
        nativeToScVal(priceScaled, { type: 'i128' }),
      ]
    );
  }

  /**
   * Get current price from oracle
   */
  async getOraclePrice(asset: string): Promise<{ price: bigint; timestamp: bigint }> {
    try {
      const result = await this.invokeContractRead<[bigint, bigint]>(
        this.oracleContract,
        'lastprice',
        [nativeToScVal(asset, { type: 'symbol' })]
      );
      return { price: result[0], timestamp: result[1] };
    } catch (error) {
      throw new Error(`Failed to get oracle price for ${asset}: ${error}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Position Functions
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get all position IDs
   */
  async getAllPositionIds(): Promise<bigint[]> {
    try {
      return await this.invokeContractRead<bigint[]>(
        this.marketContract,
        'get_all_position_ids',
        []
      );
    } catch (error) {
      console.error('Error fetching position IDs:', error);
      return [];
    }
  }

  /**
   * Get a specific position
   */
  async getPosition(positionId: bigint): Promise<Position | null> {
    try {
      const result = await this.invokeContractRead<any>(
        this.marketContract,
        'get_position',
        [nativeToScVal(positionId, { type: 'u64' })]
      );
      return result ? this.parsePosition(result) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if position is liquidatable
   */
  async isLiquidatable(positionId: bigint): Promise<boolean> {
    try {
      return await this.invokeContractRead<boolean>(
        this.marketContract,
        'is_liquidatable',
        [nativeToScVal(positionId, { type: 'u64' })]
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Execute liquidation
   */
  async liquidate(positionId: bigint): Promise<ExecutionResult> {
    return this.invokeContractWriteWithRetry(
      this.marketContract,
      'liquidate',
      [
        new Address(this.publicKey).toScVal(),
        nativeToScVal(positionId, { type: 'u64' }),
      ]
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Order Functions
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get all pending order IDs
   */
  async getAllOrderIds(): Promise<bigint[]> {
    try {
      const result = await this.invokeContractRead<any>(
        this.marketContract,
        'get_all_order_ids',
        []
      );

      // Convert to bigint array if needed
      if (Array.isArray(result)) {
        const converted = result.map(id => {
          if (typeof id === 'bigint') return id;
          if (typeof id === 'number') return BigInt(id);
          if (typeof id === 'string') return BigInt(id);
          return BigInt(0);
        });
        return converted;
      }
      return [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Get a specific order
   */
  async getOrder(orderId: bigint): Promise<Order | null> {
    try {
      const result = await this.invokeContractRead<any>(
        this.marketContract,
        'get_order',
        [nativeToScVal(orderId, { type: 'u64' })]
      );
      return result ? this.parseOrder(result) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if order should execute
   */
  async shouldExecuteOrder(orderId: bigint): Promise<boolean> {
    try {
      const result = await this.invokeContractRead<boolean>(
        this.marketContract,
        'should_execute_order',
        [nativeToScVal(orderId, { type: 'u64' })]
      );
      return result;
    } catch (error) {
      return false;
    }
  }

  /**
   * Execute an order
   */
  async executeOrder(orderId: bigint): Promise<ExecutionResult> {
    return this.invokeContractWriteWithRetry(
      this.marketContract,
      'execute_order',
      [
        new Address(this.publicKey).toScVal(),
        nativeToScVal(orderId, { type: 'u64' }),
      ]
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Funding Rate Functions
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Apply funding rate (hourly)
   */
  async applyFunding(): Promise<ExecutionResult> {
    return this.invokeContractWriteWithRetry(
      this.marketContract,
      'apply_funding',
      []
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Internal Helpers
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Invoke a contract function (read-only)
   */
  private async invokeContractRead<T>(
    contract: Contract,
    method: string,
    args: xdr.ScVal[] = []
  ): Promise<T> {
    const account = await this.getAccount();

    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const response = await this.server.simulateTransaction(tx);

    if (rpc.Api.isSimulationError(response)) {
      throw new Error(`Simulation failed: ${response.error}`);
    }

    if (!response.result) {
      throw new Error('No result from simulation');
    }

    return scValToNative(response.result.retval) as T;
  }

  /**
   * Invoke a contract function (write) with retry logic
   */
  private async invokeContractWriteWithRetry(
    contract: Contract,
    method: string,
    args: xdr.ScVal[] = []
  ): Promise<ExecutionResult> {
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await this.invokeContractWrite(contract, method, args);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);

        // Don't retry on certain errors
        if (lastError.includes('SlippageExceeded') ||
            lastError.includes('OrderNotTriggered') ||
            lastError.includes('NotLiquidatable') ||
            lastError.includes('PositionNotFound') ||
            lastError.includes('#20')) {
          return { success: false, error: lastError };
        }

        if (attempt < MAX_RETRIES) {
          await this.sleep(RETRY_DELAY_MS);
        }
      }
    }

    return { success: false, error: lastError };
  }

  /**
   * Invoke a contract function (write)
   */
  private async invokeContractWrite(
    contract: Contract,
    method: string,
    args: xdr.ScVal[] = []
  ): Promise<ExecutionResult> {
    const account = await this.getAccount();

    // Build transaction
    let tx = new TransactionBuilder(account, {
      fee: '10000000', // 1 XLM max fee
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(TX_TIMEOUT_SECONDS)
      .build();

    // Simulate to get fees and resources
    const simResponse = await this.server.simulateTransaction(tx);

    if (rpc.Api.isSimulationError(simResponse)) {
      throw new Error(`Simulation failed: ${simResponse.error}`);
    }

    // Prepare transaction with resources from simulation
    tx = rpc.assembleTransaction(tx, simResponse).build();

    // Sign
    tx.sign(this.keypair);

    // Submit
    const sendResponse = await this.server.sendTransaction(tx);

    if (sendResponse.status === 'ERROR') {
      throw new Error(`Transaction failed: ${sendResponse.errorResult}`);
    }

    // Wait for confirmation
    let getResponse = await this.server.getTransaction(sendResponse.hash);
    let pollAttempts = 0;
    const maxPollAttempts = 30;

    while (getResponse.status === 'NOT_FOUND' && pollAttempts < maxPollAttempts) {
      await this.sleep(1000);
      getResponse = await this.server.getTransaction(sendResponse.hash);
      pollAttempts++;
    }

    if (getResponse.status === 'SUCCESS') {
      // Try to extract reward from return value
      let reward: bigint | undefined;
      if (getResponse.returnValue) {
        try {
          reward = scValToNative(getResponse.returnValue) as bigint;
        } catch {
          // Ignore parse errors
        }
      }
      return { success: true, txHash: sendResponse.hash, reward };
    } else {
      throw new Error(`Transaction failed: ${getResponse.status}`);
    }
  }

  /**
   * Parse raw position data from contract
   */
  private parsePosition(raw: any): Position {
    return {
      id: BigInt(raw.id),
      trader: raw.trader,
      asset: raw.asset,
      collateral: BigInt(raw.collateral),
      size: BigInt(raw.size),
      entry_price: BigInt(raw.entry_price),
      direction: raw.direction === 0 ? 'Long' : 'Short',
      leverage: Number(raw.leverage),
      liquidation_price: BigInt(raw.liquidation_price),
      timestamp: BigInt(raw.timestamp),
      last_funding_time: BigInt(raw.last_funding_time),
      accumulated_funding: BigInt(raw.accumulated_funding),
    };
  }

  /**
   * Parse raw order data from contract
   */
  private parseOrder(raw: any): Order {
    const orderTypeMap: Record<number, Order['order_type']> = {
      0: 'LimitEntry',
      1: 'StopLoss',
      2: 'TakeProfit',
    };

    const statusMap: Record<number, Order['status']> = {
      0: 'Pending',
      1: 'Executed',
      2: 'Cancelled',
      3: 'CancelledSlippage',
      4: 'Expired',
    };

    return {
      id: BigInt(raw.id),
      trader: raw.trader,
      asset: raw.asset,
      order_type: orderTypeMap[raw.order_type] || 'LimitEntry',
      direction: raw.direction === 0 ? 'Long' : 'Short',
      collateral: BigInt(raw.collateral),
      leverage: Number(raw.leverage),
      trigger_price: BigInt(raw.trigger_price),
      trigger_condition: raw.trigger_condition === 0 ? 'Above' : 'Below',
      slippage_tolerance_bps: Number(raw.slippage_tolerance_bps),
      position_id: BigInt(raw.position_id),
      has_position: Boolean(raw.has_position),
      created_at: BigInt(raw.created_at),
      status: statusMap[raw.status] || 'Pending',
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
