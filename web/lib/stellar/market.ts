import { marketContract, usdcTokenContract, buildTransaction, submitTransaction, toScVal, rpc as sorobanRpc } from './client';
import type { Position, DisplayPosition, MarketConfig, Direction, Trade } from '@/types';
import { fromPrecision, calculatePnL } from '@/lib/utils/format';
import { rpc, scValToNative, xdr, Horizon, TransactionBuilder, BASE_FEE } from '@stellar/stellar-sdk';
import { CONTRACTS, NETWORK } from '@/lib/utils/constants';

/**
 * Raw position data from contract (before parsing)
 * Contract uses snake_case and enum indices
 */
interface RawPosition {
  id: number | bigint;
  trader: string;
  asset: string;
  direction: number | bigint; // 0 = Long, 1 = Short
  collateral: bigint;
  size: bigint;
  entry_price: bigint; // snake_case from contract
  liquidation_price: bigint; // snake_case from contract
  opened_at: number | bigint; // snake_case from contract
  last_funding_at: number | bigint;
  accumulated_funding: bigint;
}

/**
 * Parse raw contract position to typed Position
 */
function parsePosition(raw: RawPosition): Position {
  return {
    id: Number(raw.id),
    trader: raw.trader,
    asset: raw.asset,
    direction: Number(raw.direction) === 0 ? 'Long' : 'Short',
    collateral: raw.collateral,
    size: raw.size,
    entryPrice: raw.entry_price,
    liquidationPrice: raw.liquidation_price,
    openedAt: Number(raw.opened_at),
    lastFundingAt: Number(raw.last_funding_at),
    accumulatedFunding: raw.accumulated_funding,
  };
}

/**
 * Safely convert BigInt to number with precision (7 decimals)
 */
function bigIntToNumber(value: bigint | number | undefined, decimals = 7): number {
  if (value === undefined || value === null) return 0;
  const num = typeof value === 'bigint' ? Number(value) : value;
  if (isNaN(num)) return 0;
  return num / Math.pow(10, decimals);
}

/**
 * Get current USDC allowance for Market contract
 */
async function getAllowance(ownerPublicKey: string): Promise<bigint> {
  try {
    const args = [
      toScVal(ownerPublicKey, 'address'),  // from: Address (owner)
      toScVal(CONTRACTS.MARKET, 'address'), // spender: Address (Market contract)
    ];

    const account = await sorobanRpc.getAccount(ownerPublicKey);
    const operation = usdcTokenContract.call('allowance', ...args);

    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK.PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const result = await sorobanRpc.simulateTransaction(transaction);

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      return scValToNative(result.result.retval) as bigint;
    }

    return BigInt(0);
  } catch (error) {
    console.error('Error checking allowance:', error);
    return BigInt(0);
  }
}

/**
 * Approve USDC spending for Market contract
 * Uses a large allowance to avoid repeated approvals
 */
async function approveUSDC(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  amount: bigint
): Promise<void> {
  // Set a large expiration ledger (roughly 1 year: ~31536000 seconds / 5 seconds per ledger)
  const currentLedger = (await sorobanRpc.getLatestLedger()).sequence;
  const expirationLedger = currentLedger + 6_307_200; // ~1 year

  const args = [
    toScVal(signerPublicKey, 'address'),    // from: Address (owner)
    toScVal(CONTRACTS.MARKET, 'address'),   // spender: Address (Market contract)
    toScVal(amount, 'i128'),                // amount: i128
    toScVal(expirationLedger, 'u32'),       // expiration_ledger: u32
  ];

  console.log('[DEBUG] Approving USDC spending:', {
    owner: signerPublicKey,
    spender: CONTRACTS.MARKET,
    amount: amount.toString(),
    expirationLedger,
  });

  const xdrStr = await buildTransaction(signerPublicKey, usdcTokenContract, 'approve', args);
  const signedXdr = await signTransaction(xdrStr);
  const result = await submitTransaction(signedXdr);

  if (result.status !== 'SUCCESS') {
    throw new Error('Failed to approve USDC spending');
  }

  console.log('[DEBUG] USDC approval successful');
}

/**
 * Open a new leveraged position
 * Automatically handles USDC approval if needed (strictly sequential)
 */
export async function openPosition(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  params: {
    asset: string;
    collateral: bigint;
    leverage: number;
    direction: Direction;
  }
): Promise<Position> {
  // Step 1: Check current allowance
  console.log('[DEBUG] Step 1: Checking USDC allowance...');
  let currentAllowance = await getAllowance(signerPublicKey);
  console.log('[DEBUG] Current USDC allowance:', currentAllowance.toString());
  console.log('[DEBUG] Required collateral:', params.collateral.toString());

  // Step 2: Approve if needed - MUST complete before proceeding
  if (currentAllowance < params.collateral) {
    console.log('[DEBUG] Step 2: Insufficient allowance, requesting approval...');

    // Approve a large amount (1 billion USDC with 7 decimals) to avoid repeated approvals
    const approvalAmount = BigInt(1_000_000_000) * BigInt(10_000_000);

    // This will prompt Freighter and wait for on-chain confirmation
    await approveUSDC(signerPublicKey, signTransaction, approvalAmount);

    // Step 2b: Wait a moment for ledger state to propagate
    console.log('[DEBUG] Waiting for ledger state to propagate...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2c: Verify the approval worked by re-checking allowance
    currentAllowance = await getAllowance(signerPublicKey);
    console.log('[DEBUG] New allowance after approval:', currentAllowance.toString());

    if (currentAllowance < params.collateral) {
      throw new Error('Approval transaction confirmed but allowance still insufficient. Please try again.');
    }

    console.log('[DEBUG] Approval verified successfully!');
  }

  // Step 3: Now open the position (allowance is guaranteed to be sufficient)
  console.log('[DEBUG] Step 3: Opening position...');

  // Build arguments matching contract signature:
  // open_position(trader: Address, asset: Symbol, collateral: i128, leverage: u32, direction: Direction)
  const args = [
    toScVal(signerPublicKey, 'address'),  // trader: Address
    toScVal(params.asset, 'symbol'),       // asset: Symbol (e.g., "XLM", "BTC")
    toScVal(params.collateral, 'i128'),    // collateral: i128 (7 decimals)
    toScVal(params.leverage, 'u32'),       // leverage: u32 (1-10)
    toScVal(params.direction, 'direction'), // direction: Direction enum (Long=0, Short=1)
  ];

  const xdrStr = await buildTransaction(signerPublicKey, marketContract, 'open_position', args);
  const signedXdr = await signTransaction(xdrStr);
  const result = await submitTransaction(signedXdr);

  if (result.status === 'SUCCESS' && result.returnValue) {
    console.log('[DEBUG] Position opened successfully!');
    return scValToNative(result.returnValue) as Position;
  }

  throw new Error('Failed to open position');
}

/**
 * Close a position
 * Automatically handles USDC approval if needed (for fees/losses)
 */
export async function closePosition(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  positionId: number
): Promise<{ pnl: bigint; fee: bigint }> {
  // Step 1: Check current allowance
  console.log('[DEBUG] Close Position - Step 1: Checking USDC allowance...');
  let currentAllowance = await getAllowance(signerPublicKey);
  console.log('[DEBUG] Current USDC allowance:', currentAllowance.toString());

  // Step 2: Approve if needed - closing might require paying fees or covering losses
  // We approve a large amount to ensure the contract can settle any fees/losses
  const minRequiredAllowance = BigInt(100_000) * BigInt(10_000_000); // 100k USDC buffer

  if (currentAllowance < minRequiredAllowance) {
    console.log('[DEBUG] Step 2: Insufficient allowance for close, requesting approval...');

    // Approve a large amount (1 billion USDC with 7 decimals)
    const approvalAmount = BigInt(1_000_000_000) * BigInt(10_000_000);

    // This will prompt Freighter and wait for on-chain confirmation
    await approveUSDC(signerPublicKey, signTransaction, approvalAmount);

    // Wait for ledger state to propagate
    console.log('[DEBUG] Waiting for ledger state to propagate...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify the approval worked
    currentAllowance = await getAllowance(signerPublicKey);
    console.log('[DEBUG] New allowance after approval:', currentAllowance.toString());

    if (currentAllowance < minRequiredAllowance) {
      throw new Error('Approval transaction confirmed but allowance still insufficient. Please try again.');
    }

    console.log('[DEBUG] Approval verified successfully!');
  }

  // Step 3: Close the position
  console.log('[DEBUG] Step 3: Closing position...');

  // Contract signature: close_position(trader: Address, position_id: u64)
  const args = [
    toScVal(signerPublicKey, 'address'),  // trader: Address
    toScVal(positionId, 'u64'),            // position_id: u64 (not u32!)
  ];

  const xdrStr = await buildTransaction(signerPublicKey, marketContract, 'close_position', args);
  const signedXdr = await signTransaction(xdrStr);
  const result = await submitTransaction(signedXdr);

  if (result.status === 'SUCCESS' && result.returnValue) {
    console.log('[DEBUG] Position closed successfully!');
    return scValToNative(result.returnValue) as { pnl: bigint; fee: bigint };
  }

  throw new Error('Failed to close position');
}

/**
 * Add collateral to a position
 */
export async function addCollateral(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  positionId: number,
  amount: bigint
): Promise<void> {
  // Contract signature: add_collateral(trader: Address, position_id: u64, amount: i128)
  const args = [
    toScVal(signerPublicKey, 'address'),  // trader: Address
    toScVal(positionId, 'u64'),            // position_id: u64 (not u32!)
    toScVal(amount, 'i128'),               // amount: i128
  ];

  const xdr = await buildTransaction(signerPublicKey, marketContract, 'add_collateral', args);
  const signedXdr = await signTransaction(xdr);
  await submitTransaction(signedXdr);
}

/**
 * Get all positions for a trader (read-only)
 */
export async function getPositions(traderPublicKey: string): Promise<Position[]> {
  try {
    const args = [toScVal(traderPublicKey, 'address')];

    const result = await sorobanRpc.simulateTransaction(
      await buildSimulateTransaction(traderPublicKey, 'get_positions', args)
    );

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      const rawPositions = scValToNative(result.result.retval) as RawPosition[];
      console.log('[DEBUG] Raw positions from contract:', rawPositions);
      return rawPositions.map(parsePosition);
    }

    return [];
  } catch (error) {
    console.error('Error fetching positions:', error);
    return [];
  }
}

/**
 * Get position PnL (read-only)
 */
export async function getPositionPnL(
  traderPublicKey: string,
  positionId: number
): Promise<bigint> {
  try {
    // Contract signature: get_position_pnl(position_id: u64)
    const args = [toScVal(positionId, 'u64')];

    const result = await sorobanRpc.simulateTransaction(
      await buildSimulateTransaction(traderPublicKey, 'get_position_pnl', args)
    );

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      return scValToNative(result.result.retval) as bigint;
    }

    return BigInt(0);
  } catch {
    return BigInt(0);
  }
}

/**
 * Get market configuration (read-only)
 */
export async function getMarketConfig(publicKey: string): Promise<MarketConfig | null> {
  try {
    const result = await sorobanRpc.simulateTransaction(
      await buildSimulateTransaction(publicKey, 'get_config', [])
    );

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      return scValToNative(result.result.retval) as MarketConfig;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Build transaction for simulation (read-only calls)
 */
async function buildSimulateTransaction(
  publicKey: string,
  method: string,
  args: ReturnType<typeof toScVal>[]
) {
  const { TransactionBuilder, BASE_FEE } = await import('@stellar/stellar-sdk');
  const { NETWORK } = await import('@/lib/utils/constants');

  const account = await sorobanRpc.getAccount(publicKey);
  const operation = marketContract.call(method, ...args);

  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();
}

/**
 * Convert contract Position to DisplayPosition
 */
export function toDisplayPosition(
  position: Position,
  currentPrice: number
): DisplayPosition {
  const entryPrice = bigIntToNumber(position.entryPrice);
  const collateral = bigIntToNumber(position.collateral);
  const size = bigIntToNumber(position.size);
  const liquidationPrice = bigIntToNumber(position.liquidationPrice);
  const leverage = collateral > 0 ? size / collateral : 0;

  const isLong = position.direction === 'Long';
  const { pnl, pnlPercent } = calculatePnL(
    entryPrice,
    currentPrice,
    size,
    isLong
  );

  return {
    id: position.id,
    trader: position.trader,
    asset: position.asset,
    direction: position.direction,
    collateral,
    size,
    entryPrice,
    liquidationPrice,
    currentPrice,
    pnl: isNaN(pnl) ? 0 : pnl,
    pnlPercent: isNaN(pnlPercent) ? 0 : pnlPercent,
    leverage: isNaN(leverage) ? 0 : leverage,
    openedAt: new Date(position.openedAt * 1000),
  };
}

/**
 * Raw event data for position_closed from contract (NEW FORMAT)
 * Contract emits: (position_id, trader, asset, direction, size, entry_price, exit_price, pnl, funding_paid)
 */
interface RawPositionClosedEvent {
  0: number | bigint;  // position_id
  1: string;           // trader address
  2: string;           // asset (Symbol as string)
  3: number | { Long?: null; Short?: null };  // direction (0=Long, 1=Short or enum object)
  4: bigint;           // size
  5: bigint;           // entry_price
  6: bigint;           // exit_price
  7: bigint;           // pnl
  8: bigint;           // funding_paid (fee)
}

/**
 * Fetch trade history by querying Horizon for transactions and parsing Soroban events.
 * Parses successful transactions to find position_closed events from the Market contract.
 */
export async function getTradeHistory(traderPublicKey: string): Promise<Trade[]> {
  try {
    const trades: Trade[] = [];

    console.log('[TradeHistory] Fetching for trader:', traderPublicKey);
    console.log('[TradeHistory] Using Market contract:', CONTRACTS.MARKET);

    const horizonServer = new Horizon.Server(NETWORK.HORIZON_URL);

    // Fetch user's recent transactions (limit 100, ordered by most recent)
    const transactionsResponse = await horizonServer
      .transactions()
      .forAccount(traderPublicKey)
      .order('desc')
      .limit(100)
      .call();

    console.log('[TradeHistory] Found', transactionsResponse.records.length, 'transactions');

    for (const tx of transactionsResponse.records) {
      try {
        // Only process successful transactions
        if (!tx.successful) continue;

        // Try to parse as a close_position transaction by checking events in metadata
        const trade = parseClosePositionFromTransaction(tx, traderPublicKey);
        if (trade) {
          trades.push(trade);
        }
      } catch {
        // Continue with next transaction - many transactions won't be close_position
      }
    }

    console.log('[TradeHistory] Found', trades.length, 'trades from Horizon');

    // If no trades found via Horizon, try the Soroban events as fallback
    if (trades.length === 0) {
      const eventTrades = await getTradeHistoryFromEvents(traderPublicKey);
      trades.push(...eventTrades);
    }

    // Sort by timestamp descending (newest first)
    trades.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return trades;
  } catch (error) {
    console.error('Error fetching trade history:', error);
    // Try fallback to events on error
    try {
      return await getTradeHistoryFromEvents(traderPublicKey);
    } catch {
      return [];
    }
  }
}

/**
 * Parse a close_position transaction to extract trade data.
 * Looks for position_closed events in the transaction metadata.
 * NEW FORMAT: (position_id, trader, asset, direction, size, entry_price, exit_price, pnl, funding_paid)
 */
function parseClosePositionFromTransaction(
  tx: Horizon.ServerApi.TransactionRecord,
  traderPublicKey: string
): Trade | null {
  try {
    // Fetch transaction result meta to get return value
    const resultMetaXdr = tx.result_meta_xdr;
    if (!resultMetaXdr) return null;

    // Parse the result meta XDR
    const resultMeta = xdr.TransactionMeta.fromXDR(resultMetaXdr, 'base64');

    // For Soroban, the return value is in v3.sorobanMeta (switch() returns 3 for v3)
    if (resultMeta.switch() !== 3) return null;

    const v3 = resultMeta.v3();
    const sorobanMeta = v3.sorobanMeta();
    if (!sorobanMeta) return null;

    // Extract trade info from events in the transaction
    const events = sorobanMeta.events();
    if (!events || events.length === 0) return null;

    // Look for position_closed event
    for (const event of events) {
      try {
        const eventBody = event.body().v0();
        const topics = eventBody.topics();
        const data = eventBody.data();

        // Check if this is a position_closed event
        if (topics.length > 0) {
          const firstTopic = scValToNative(topics[0]);
          if (firstTopic === 'position_closed') {
            // Parse event data - NEW FORMAT:
            // (position_id, trader, asset, direction, size, entry_price, exit_price, pnl, funding_paid)
            const eventData = scValToNative(data);

            // Extract fields from the event data
            let positionId: number | bigint = 0;
            let trader: string = traderPublicKey;
            let asset: string = 'Unknown';
            let direction: Direction = 'Long';
            let size: bigint = BigInt(0);
            let entryPrice: bigint = BigInt(0);
            let exitPrice: bigint = BigInt(0);
            let pnl: bigint = BigInt(0);
            let fee: bigint = BigInt(0);

            if (Array.isArray(eventData)) {
              // Array format: [position_id, trader, asset, direction, size, entry_price, exit_price, pnl, funding_paid]
              positionId = eventData[0] as number | bigint;
              trader = eventData[1] as string;
              asset = eventData[2] as string;
              // Direction can be 0/1 or {Long: null}/{Short: null}
              const dirVal = eventData[3];
              if (typeof dirVal === 'number') {
                direction = dirVal === 0 ? 'Long' : 'Short';
              } else if (typeof dirVal === 'object' && dirVal !== null) {
                direction = 'Long' in dirVal ? 'Long' : 'Short';
              }
              size = eventData[4] as bigint;
              entryPrice = eventData[5] as bigint;
              exitPrice = eventData[6] as bigint;
              pnl = eventData[7] as bigint;
              fee = eventData[8] as bigint;
            } else if (typeof eventData === 'object' && eventData !== null) {
              const obj = eventData as Record<string, unknown>;
              positionId = (obj[0] || obj.position_id || 0) as number | bigint;
              trader = (obj[1] || obj.trader || traderPublicKey) as string;
              asset = (obj[2] || obj.asset || 'Unknown') as string;
              const dirVal = obj[3] || obj.direction;
              if (typeof dirVal === 'number') {
                direction = dirVal === 0 ? 'Long' : 'Short';
              } else if (typeof dirVal === 'object' && dirVal !== null) {
                direction = 'Long' in (dirVal as object) ? 'Long' : 'Short';
              }
              size = (obj[4] || obj.size || BigInt(0)) as bigint;
              entryPrice = (obj[5] || obj.entry_price || BigInt(0)) as bigint;
              exitPrice = (obj[6] || obj.exit_price || BigInt(0)) as bigint;
              pnl = (obj[7] || obj.pnl || BigInt(0)) as bigint;
              fee = (obj[8] || obj.funding_paid || BigInt(0)) as bigint;
            } else {
              continue;
            }

            // Create trade with full data
            return {
              id: tx.id,
              txHash: tx.hash,
              trader: trader || traderPublicKey,
              asset: asset || 'Unknown',
              direction: direction,
              type: 'close',
              size: bigIntToNumber(size),
              price: bigIntToNumber(exitPrice),
              entryPrice: bigIntToNumber(entryPrice),
              pnl: bigIntToNumber(pnl),
              fee: bigIntToNumber(fee),
              timestamp: new Date(tx.created_at),
            };
          }
        }
      } catch {
        // Continue with next event
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Fallback: Fetch trade history from Soroban contract events
 */
async function getTradeHistoryFromEvents(traderPublicKey: string): Promise<Trade[]> {
  try {
    // Get latest ledger to calculate a valid start ledger
    const latestLedger = await sorobanRpc.getLatestLedger();

    // RPC nodes typically retain ~17280 ledgers (~24 hours) to ~120000 ledgers (~7 days)
    // Use a conservative lookback of 10000 ledgers (~14 hours) to stay within range
    const LOOKBACK_LEDGERS = 10000;
    const startLedger = Math.max(latestLedger.sequence - LOOKBACK_LEDGERS, latestLedger.sequence - 17000);

    console.log(`[TradeHistory] Fetching events from ledger ${startLedger} to ${latestLedger.sequence}`);

    // Try position_closed first (what contract actually emits)
    const response = await sorobanRpc.getEvents({
      startLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [CONTRACTS.MARKET],
          topics: [
            [xdr.ScVal.scvSymbol('position_closed').toXDR('base64')],
          ],
        },
      ],
      limit: 100,
    });

    if (!response.events || response.events.length === 0) {
      console.log('[TradeHistory] No position_closed events found');
      return [];
    }

    console.log(`[TradeHistory] Found ${response.events.length} events`);
    return parseEventsToTrades(response.events, traderPublicKey);
  } catch (error) {
    console.error('Error fetching trade history from events:', error);
    return [];
  }
}

/**
 * Parse Soroban events into Trade objects
 * NEW FORMAT: (position_id, trader, asset, direction, size, entry_price, exit_price, pnl, funding_paid)
 */
function parseEventsToTrades(events: rpc.Api.EventResponse[], traderPublicKey: string): Trade[] {
  const trades: Trade[] = [];

  for (const event of events) {
    try {
      // Parse the event value (typically contains the event data)
      const eventData = event.value;
      if (!eventData) continue;

      const data = scValToNative(eventData);

      // Extract fields from the NEW event format
      let trader: string = traderPublicKey;
      let asset: string = 'Unknown';
      let direction: Direction = 'Long';
      let size: bigint = BigInt(0);
      let entryPrice: bigint = BigInt(0);
      let exitPrice: bigint = BigInt(0);
      let pnl: bigint = BigInt(0);
      let fee: bigint = BigInt(0);

      if (Array.isArray(data)) {
        // NEW FORMAT: [position_id, trader, asset, direction, size, entry_price, exit_price, pnl, funding_paid]
        trader = data[1] as string;
        asset = data[2] as string;
        const dirVal = data[3];
        if (typeof dirVal === 'number') {
          direction = dirVal === 0 ? 'Long' : 'Short';
        } else if (typeof dirVal === 'object' && dirVal !== null) {
          direction = 'Long' in dirVal ? 'Long' : 'Short';
        }
        size = data[4] as bigint;
        entryPrice = data[5] as bigint;
        exitPrice = data[6] as bigint;
        pnl = data[7] as bigint;
        fee = data[8] as bigint;
      } else if (typeof data === 'object' && data !== null) {
        const obj = data as Record<string, unknown>;
        trader = (obj[1] || obj.trader || '') as string;
        asset = (obj[2] || obj.asset || 'Unknown') as string;
        const dirVal = obj[3] || obj.direction;
        if (typeof dirVal === 'number') {
          direction = dirVal === 0 ? 'Long' : 'Short';
        } else if (typeof dirVal === 'object' && dirVal !== null) {
          direction = 'Long' in (dirVal as object) ? 'Long' : 'Short';
        }
        size = (obj[4] || obj.size || BigInt(0)) as bigint;
        entryPrice = (obj[5] || obj.entry_price || BigInt(0)) as bigint;
        exitPrice = (obj[6] || obj.exit_price || BigInt(0)) as bigint;
        pnl = (obj[7] || obj.pnl || BigInt(0)) as bigint;
        fee = (obj[8] || obj.funding_paid || BigInt(0)) as bigint;
      } else {
        continue;
      }

      // Filter by trader address
      if (trader && trader !== traderPublicKey) continue;

      const trade: Trade = {
        id: `${event.id}`,
        txHash: event.txHash,
        trader: trader || traderPublicKey,
        asset: asset || 'Unknown',
        direction: direction,
        type: 'close',
        size: bigIntToNumber(size),
        price: bigIntToNumber(exitPrice),
        entryPrice: bigIntToNumber(entryPrice),
        pnl: bigIntToNumber(pnl),
        fee: bigIntToNumber(fee),
        timestamp: new Date(event.ledgerClosedAt || Date.now()),
      };

      trades.push(trade);
    } catch (parseError) {
      console.warn('Failed to parse event:', parseError);
    }
  }

  return trades;
}
