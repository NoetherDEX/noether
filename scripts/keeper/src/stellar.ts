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
// Type-only — the @noeracle/sdk package is ESM-only; the index.ts loader
// uses dynamic import, but we only need the Attestation shape here.
import type { Attestation } from '@noeracle/sdk';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const TX_TIMEOUT_SECONDS = 300;

export class StellarClient {
  private server: rpc.Server;
  private keypair: Keypair;
  private networkPassphrase: string;
  private marketContract: Contract;
  private noeracleContract: Contract;

  constructor(private config: KeeperConfig) {
    // 15s HTTP timeout so a hung RPC can't wedge a keeper cycle indefinitely (K-1).
    this.server = new rpc.Server(config.rpcUrl, {
      timeout: 15_000,
      allowHttp: config.rpcUrl.startsWith('http://'),
    });
    this.keypair = Keypair.fromSecret(config.secretKey);
    this.networkPassphrase = config.networkPassphrase;
    this.marketContract = new Contract(config.marketContractId);
    this.noeracleContract = new Contract(config.noeracleContractId);
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
   * Publish a signed Noeracle attestation to the contract's persistent
   * storage. Args order matches the contract's `update_ed25519_persistent`
   * signature: (asset, price, timestamp, round_id, pubkeys, sigs).
   *
   * The attestation message is laid out as [tag(8) || price(16) || ts(8) || …],
   * so the first 8 bytes give us the BytesN<8> asset tag the contract
   * expects. We don't need to map symbols ourselves — Noeracle's publisher
   * already encoded the right tag into the signed message.
   */
  async updateNoeraclePersistent(attestation: Attestation): Promise<ExecutionResult> {
    const messageBuf = Buffer.from(attestation.message, 'hex');
    const tag = messageBuf.subarray(0, 8);
    const pubkey = Buffer.from(attestation.publisher, 'hex');
    const sig = Buffer.from(attestation.signature, 'hex');

    return this.invokeContractWriteWithRetry(
      this.noeracleContract,
      'update_ed25519_persistent',
      [
        xdr.ScVal.scvBytes(tag),                                       // asset:     BytesN<8>
        nativeToScVal(BigInt(attestation.price), { type: 'i128' }),    // price:     i128
        nativeToScVal(BigInt(attestation.timestamp), { type: 'u64' }), // timestamp: u64
        nativeToScVal(BigInt(attestation.round_id), { type: 'u64' }),  // round_id:  u64
        xdr.ScVal.scvVec([xdr.ScVal.scvBytes(pubkey)]),                // pubkeys:   Vec<BytesN<32>>
        xdr.ScVal.scvVec([xdr.ScVal.scvBytes(sig)]),                   // sigs:      Vec<BytesN<64>>
      ]
    );
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

  // ═══════════════════════════════════════════════════════════════════════
  // Cross-Margin Functions
  // ═══════════════════════════════════════════════════════════════════════

  // isCrossLiquidatable removed - contract function removed for WASM size.
  // Keeper now attempts liquidation directly; contract rejects if healthy.

  /**
   * Liquidate a cross-margin account (closes all cross positions)
   */
  async liquidateCrossAccount(trader: string): Promise<ExecutionResult> {
    return this.invokeContractWriteWithRetry(
      this.marketContract,
      'liquidate_cross_account',
      [
        new Address(this.publicKey).toScVal(),
        new Address(trader).toScVal(),
      ]
    );
  }

  /**
   * Get cross-margin position IDs for a trader
   */
  async getCrossMarginPositions(trader: string): Promise<bigint[]> {
    try {
      return await this.invokeContractRead<bigint[]>(
        this.marketContract,
        'get_cross_margin_positions',
        [new Address(trader).toScVal()]
      );
    } catch (error) {
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Trailing Stop Functions
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Update trailing stop peak for a single order
   */
  async updateTrailingPeak(orderId: bigint): Promise<ExecutionResult> {
    return this.invokeContractWriteWithRetry(
      this.marketContract,
      'update_trailing_peak',
      [nativeToScVal(orderId, { type: 'u64' })]
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

        // Don't retry on certain errors (business logic, not transient)
        if (lastError.includes('SlippageExceeded') ||
            lastError.includes('OrderNotTriggered') ||
            lastError.includes('NotLiquidatable') ||
            lastError.includes('CrossMarginNotLiquidatable') ||
            lastError.includes('#78') || // CrossMarginNotLiquidatable
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

    // Submit with retry on TRY_AGAIN_LATER
    let sendResponse;
    for (let sendAttempt = 0; sendAttempt < 3; sendAttempt++) {
      sendResponse = await this.server.sendTransaction(tx);

      if (sendResponse.status === 'PENDING') break;

      if (sendResponse.status === 'TRY_AGAIN_LATER') {
        await this.sleep(3000);
        // Re-fetch account for fresh sequence number
        const freshAccount = await this.getAccount();
        tx = new TransactionBuilder(freshAccount, {
          fee: '10000000',
          networkPassphrase: this.networkPassphrase,
        })
          .addOperation(contract.call(method, ...args))
          .setTimeout(TX_TIMEOUT_SECONDS)
          .build();
        const freshSim = await this.server.simulateTransaction(tx);
        if (rpc.Api.isSimulationError(freshSim)) {
          throw new Error(`Simulation failed on retry: ${freshSim.error}`);
        }
        tx = rpc.assembleTransaction(tx, freshSim).build();
        tx.sign(this.keypair);
        continue;
      }

      if (sendResponse.status === 'ERROR') {
        const errDetail = (sendResponse as any).errorResult
          ? JSON.stringify((sendResponse as any).errorResult).slice(0, 200)
          : 'no detail';
        throw new Error(`Transaction send failed: ${errDetail}`);
      }

      throw new Error(`Unexpected send status: ${sendResponse.status}`);
    }

    if (!sendResponse || sendResponse.status !== 'PENDING') {
      throw new Error(`Transaction not accepted after retries: ${sendResponse?.status}`);
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
      margin_mode: Number(raw.margin_mode ?? 0),
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
      3: 'StopLimit',
      4: 'TrailingStop',
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
      limit_price: BigInt(raw.limit_price ?? 0),
      trailing_percent_bps: Number(raw.trailing_percent_bps ?? 0),
      time_in_force: Number(raw.time_in_force ?? 0),
      stop_limit_phase: Number(raw.stop_limit_phase ?? 0),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
