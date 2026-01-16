/**
 * Stellar SDK Wrapper
 *
 * Handles all Stellar/Soroban blockchain interactions
 */

import {
  Keypair,
  Contract,
  SorobanRpc,
  TransactionBuilder,
  Networks,
  Operation,
  xdr,
  Address,
  scValToNative,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import { KeeperConfig } from './config';

export class StellarClient {
  private server: SorobanRpc.Server;
  private keypair: Keypair;
  private networkPassphrase: string;

  constructor(config: KeeperConfig) {
    this.server = new SorobanRpc.Server(config.rpcUrl);
    this.keypair = Keypair.fromSecret(config.secretKey);
    this.networkPassphrase = config.networkPassphrase;
  }

  /**
   * Get the keeper's public key
   */
  get publicKey(): string {
    return this.keypair.publicKey();
  }

  /**
   * Get account info
   */
  async getAccount(): Promise<SorobanRpc.Api.GetAccountResponse> {
    return this.server.getAccount(this.keypair.publicKey());
  }

  /**
   * Invoke a contract function (read-only)
   */
  async invokeContractRead<T>(
    contractId: string,
    method: string,
    args: xdr.ScVal[] = []
  ): Promise<T> {
    const account = await this.getAccount();

    const contract = new Contract(contractId);
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const response = await this.server.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(response)) {
      throw new Error(`Simulation failed: ${response.error}`);
    }

    if (!response.result) {
      throw new Error('No result from simulation');
    }

    return scValToNative(response.result.retval) as T;
  }

  /**
   * Invoke a contract function (write)
   */
  async invokeContractWrite(
    contractId: string,
    method: string,
    args: xdr.ScVal[] = []
  ): Promise<string> {
    const account = await this.getAccount();
    const contract = new Contract(contractId);

    // Build transaction
    let tx = new TransactionBuilder(account, {
      fee: '100000', // Will be adjusted by simulation
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(300)
      .build();

    // Simulate to get fees and resources
    const simResponse = await this.server.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(simResponse)) {
      throw new Error(`Simulation failed: ${simResponse.error}`);
    }

    // Prepare transaction with resources from simulation
    tx = SorobanRpc.assembleTransaction(tx, simResponse).build();

    // Sign
    tx.sign(this.keypair);

    // Submit
    const sendResponse = await this.server.sendTransaction(tx);

    if (sendResponse.status === 'ERROR') {
      throw new Error(`Transaction failed: ${sendResponse.errorResult}`);
    }

    // Wait for confirmation
    let getResponse = await this.server.getTransaction(sendResponse.hash);
    while (getResponse.status === 'NOT_FOUND') {
      await this.sleep(1000);
      getResponse = await this.server.getTransaction(sendResponse.hash);
    }

    if (getResponse.status === 'SUCCESS') {
      return sendResponse.hash;
    } else {
      throw new Error(`Transaction failed: ${getResponse.status}`);
    }
  }

  /**
   * Get all positions from market contract
   */
  async getAllPositionIds(marketContractId: string): Promise<bigint[]> {
    try {
      return await this.invokeContractRead<bigint[]>(
        marketContractId,
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
  async getPosition(marketContractId: string, positionId: bigint): Promise<any> {
    try {
      const idArg = nativeToScVal(positionId, { type: 'u64' });
      return await this.invokeContractRead(
        marketContractId,
        'get_position',
        [idArg]
      );
    } catch (error) {
      console.error(`Error fetching position ${positionId}:`, error);
      return null;
    }
  }

  /**
   * Check if position is liquidatable
   */
  async isLiquidatable(marketContractId: string, positionId: bigint): Promise<boolean> {
    try {
      const idArg = nativeToScVal(positionId, { type: 'u64' });
      return await this.invokeContractRead<boolean>(
        marketContractId,
        'is_liquidatable',
        [idArg]
      );
    } catch (error) {
      console.error(`Error checking liquidation for ${positionId}:`, error);
      return false;
    }
  }

  /**
   * Execute liquidation
   */
  async liquidate(marketContractId: string, positionId: bigint): Promise<string> {
    const keeperArg = new Address(this.publicKey).toScVal();
    const idArg = nativeToScVal(positionId, { type: 'u64' });

    return this.invokeContractWrite(
      marketContractId,
      'liquidate',
      [keeperArg, idArg]
    );
  }

  /**
   * Get current price from oracle
   */
  async getPrice(oracleContractId: string, asset: string): Promise<bigint> {
    try {
      const assetArg = nativeToScVal(asset, { type: 'symbol' });
      const [price, _timestamp] = await this.invokeContractRead<[bigint, bigint]>(
        oracleContractId,
        'lastprice',
        [assetArg]
      );
      return price;
    } catch (error) {
      console.error(`Error fetching price for ${asset}:`, error);
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
