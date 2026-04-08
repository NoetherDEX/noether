import { marketContract, buildTransaction, submitTransaction, toScVal, rpc as sorobanRpc } from './client';
import type { Position, DisplayPosition, MarketConfig, Direction, Trade, Order, DisplayOrder, OrderType, TriggerCondition, OrderStatus } from '@/types';
import { fromPrecision, calculatePnL } from '@/lib/utils/format';
import { rpc, scValToNative, xdr, Horizon } from '@stellar/stellar-sdk';
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
  margin_mode?: number | bigint; // 0 = Isolated, 1 = Cross
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
    marginMode: Number(raw.margin_mode ?? 0) === 1 ? 'Cross' : 'Isolated',
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
 * Open a new leveraged position
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
  console.log('[DEBUG] Opening position...');

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
 */
export async function closePosition(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  positionId: number
): Promise<{ pnl: bigint; fee: bigint }> {
  console.log('[DEBUG] Closing position...');

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
 * Add collateral to a position.
 * NOTE: Contract function removed for WASM size. Close and reopen with more collateral.
 */
export async function addCollateral(
  _signerPublicKey: string,
  _signTransaction: (xdr: string) => Promise<string>,
  _positionId: number,
  _amount: bigint
): Promise<void> {
  throw new Error('Add collateral is not available. Close the position and reopen with more collateral.');
}

/**
 * Get all positions for a trader (read-only).
 * Uses get_all_position_ids + get_position (per-ID) since get_positions was
 * removed from the contract to stay under the 64KB WASM limit.
 */
export async function getPositions(traderPublicKey: string): Promise<Position[]> {
  try {
    // 1. Fetch all position IDs
    const idsResult = await sorobanRpc.simulateTransaction(
      await buildSimulateTransaction(traderPublicKey, 'get_all_position_ids', [])
    );

    if (!rpc.Api.isSimulationSuccess(idsResult) || !idsResult.result?.retval) {
      return [];
    }

    const allIds = (scValToNative(idsResult.result.retval) as (number | bigint)[]).map(Number);

    // 2. Fetch each position and filter by trader
    const positions: Position[] = [];
    for (const id of allIds) {
      try {
        const args = [toScVal(id, 'u64')];
        const posResult = await sorobanRpc.simulateTransaction(
          await buildSimulateTransaction(traderPublicKey, 'get_position', args)
        );
        if (rpc.Api.isSimulationSuccess(posResult) && posResult.result?.retval) {
          const raw = scValToNative(posResult.result.retval) as RawPosition | null;
          if (raw && raw.trader === traderPublicKey) {
            positions.push(parsePosition(raw));
          }
        }
      } catch {
        // Position might have been closed between ID fetch and detail fetch
      }
    }

    return positions;
  } catch (error) {
    console.error('Error fetching positions:', error);
    return [];
  }
}

// getPositionPnL removed - contract function removed for WASM size.
// Frontend calculates PnL client-side from position data + oracle price.

// getMarketConfig removed - contract function removed for WASM size.
// Config is static and set at initialization. Use constants from TRADING config.

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
    .setTimeout(300)
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
    marginMode: position.marginMode || 'Isolated',
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
/**
 * Raw order data from contract (before parsing)
 * Contract uses snake_case and enum indices
 */
interface RawOrder {
  id: number | bigint;
  trader: string;
  asset: string;
  order_type: number | bigint;
  direction: number | bigint;
  collateral: bigint;
  leverage: number | bigint;
  trigger_price: bigint;
  trigger_condition: number | bigint;
  slippage_tolerance_bps: number | bigint;
  position_id: number | bigint;
  has_position: boolean;
  created_at: number | bigint;
  status: number | bigint;
  limit_price?: bigint;
  trailing_percent_bps?: number | bigint;
  time_in_force?: number | bigint;
  stop_limit_phase?: number | bigint;
}

/**
 * Parse raw contract order to typed Order
 */
function parseOrder(raw: RawOrder): Order {
  const orderTypeMap: Record<number, OrderType> = {
    0: 'LimitEntry',
    1: 'StopLoss',
    2: 'TakeProfit',
    3: 'StopLimit',
    4: 'TrailingStop',
  };

  const statusMap: Record<number, OrderStatus> = {
    0: 'Pending',
    1: 'Executed',
    2: 'Cancelled',
    3: 'CancelledSlippage',
    4: 'Expired',
  };

  return {
    id: Number(raw.id),
    trader: raw.trader,
    asset: raw.asset,
    orderType: orderTypeMap[Number(raw.order_type)] || 'LimitEntry',
    direction: Number(raw.direction) === 0 ? 'Long' : 'Short',
    collateral: raw.collateral,
    leverage: Number(raw.leverage),
    triggerPrice: raw.trigger_price,
    triggerCondition: Number(raw.trigger_condition) === 0 ? 'Above' : 'Below',
    slippageToleranceBps: Number(raw.slippage_tolerance_bps),
    positionId: Number(raw.position_id),
    hasPosition: raw.has_position,
    createdAt: Number(raw.created_at),
    status: statusMap[Number(raw.status)] || 'Pending',
    limitPrice: raw.limit_price ?? BigInt(0),
    trailingPercentBps: Number(raw.trailing_percent_bps ?? 0),
    timeInForce: Number(raw.time_in_force ?? 0),
    stopLimitPhase: Number(raw.stop_limit_phase ?? 0),
  };
}

/**
 * Convert contract Order to DisplayOrder
 */
export function toDisplayOrder(order: Order): DisplayOrder {
  const collateral = bigIntToNumber(order.collateral);
  const triggerPrice = bigIntToNumber(order.triggerPrice);
  const positionSize = collateral * order.leverage;

  return {
    id: order.id,
    trader: order.trader,
    asset: order.asset,
    orderType: order.orderType,
    direction: order.direction,
    collateral,
    leverage: order.leverage,
    triggerPrice,
    triggerCondition: order.triggerCondition,
    slippageToleranceBps: order.slippageToleranceBps,
    positionId: order.positionId,
    hasPosition: order.hasPosition,
    createdAt: new Date(order.createdAt * 1000),
    status: order.status,
    limitPrice: bigIntToNumber(order.limitPrice),
    trailingPercentBps: order.trailingPercentBps,
    stopLimitPhase: order.stopLimitPhase,
    positionSize,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Order Functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Place a limit entry order
 * Locks collateral immediately, executes when trigger price is reached
 */
export async function placeLimitOrder(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  params: {
    asset: string;
    direction: Direction;
    collateral: bigint;
    leverage: number;
    triggerPrice: bigint;
    triggerCondition: TriggerCondition;
    slippageToleranceBps: number;
    timeInForce?: number; // 0=GTC, 1=IOC, 2=PostOnly. Bit 8 = reduce_only
  }
): Promise<Order> {
  console.log('[DEBUG] Placing limit order...');

  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(params.asset, 'symbol'),
    toScVal(params.direction, 'direction'),
    toScVal(params.collateral, 'i128'),
    toScVal(params.leverage, 'u32'),
    toScVal(params.triggerPrice, 'i128'),
    toScVal(params.triggerCondition === 'Above', 'bool'),
    toScVal(params.slippageToleranceBps, 'u32'),
    toScVal(params.timeInForce ?? 0, 'u32'),
  ];

  const xdrStr = await buildTransaction(signerPublicKey, marketContract, 'place_limit_order', args);
  const signedXdr = await signTransaction(xdrStr);
  const result = await submitTransaction(signedXdr);

  if (result.status === 'SUCCESS' && result.returnValue) {
    console.log('[DEBUG] Limit order placed successfully!');
    const rawOrder = scValToNative(result.returnValue) as RawOrder;
    return parseOrder(rawOrder);
  }

  throw new Error('Failed to place limit order');
}

/**
 * Set stop-loss for an existing position
 */
export async function setStopLoss(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  params: {
    positionId: number;
    triggerPrice: bigint;
    slippageToleranceBps: number;
  }
): Promise<Order> {
  console.log('[DEBUG] Setting stop-loss for position:', params.positionId);

  // Contract signature: set_stop_loss(trader, position_id, trigger_price, slippage_tolerance_bps)
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(params.positionId, 'u64'),
    toScVal(params.triggerPrice, 'i128'),
    toScVal(params.slippageToleranceBps, 'u32'),
  ];

  const xdrStr = await buildTransaction(signerPublicKey, marketContract, 'set_stop_loss', args);
  const signedXdr = await signTransaction(xdrStr);
  const result = await submitTransaction(signedXdr);

  if (result.status === 'SUCCESS' && result.returnValue) {
    console.log('[DEBUG] Stop-loss set successfully!');
    const rawOrder = scValToNative(result.returnValue) as RawOrder;
    return parseOrder(rawOrder);
  }

  throw new Error('Failed to set stop-loss');
}

/**
 * Set take-profit for an existing position
 */
export async function setTakeProfit(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  params: {
    positionId: number;
    triggerPrice: bigint;
    slippageToleranceBps: number;
    limitPrice?: bigint;
  }
): Promise<Order> {
  console.log('[DEBUG] Setting take-profit for position:', params.positionId);

  // Contract signature: set_take_profit(trader, position_id, trigger_price, slippage_tolerance_bps, limit_price)
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(params.positionId, 'u64'),
    toScVal(params.triggerPrice, 'i128'),
    toScVal(params.slippageToleranceBps, 'u32'),
    toScVal(params.limitPrice ?? BigInt(0), 'i128'),
  ];

  const xdrStr = await buildTransaction(signerPublicKey, marketContract, 'set_take_profit', args);
  const signedXdr = await signTransaction(xdrStr);
  const result = await submitTransaction(signedXdr);

  if (result.status === 'SUCCESS' && result.returnValue) {
    console.log('[DEBUG] Take-profit set successfully!');
    const rawOrder = scValToNative(result.returnValue) as RawOrder;
    return parseOrder(rawOrder);
  }

  throw new Error('Failed to set take-profit');
}

/**
 * Cancel a pending order
 */
export async function cancelOrder(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  orderId: number
): Promise<void> {
  console.log('[DEBUG] Cancelling order:', orderId);

  // Contract signature: cancel_order(trader, order_id)
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(orderId, 'u64'),
  ];

  const xdrStr = await buildTransaction(signerPublicKey, marketContract, 'cancel_order', args);
  const signedXdr = await signTransaction(xdrStr);
  const result = await submitTransaction(signedXdr);

  if (result.status === 'SUCCESS') {
    console.log('[DEBUG] Order cancelled successfully!');
    return;
  }

  throw new Error('Failed to cancel order');
}

/**
 * Get all orders for a trader (read-only).
 * Uses get_all_order_ids + get_order since get_orders was removed for WASM size.
 */
export async function getOrders(traderPublicKey: string): Promise<Order[]> {
  try {
    const allIds = await getAllOrderIds(traderPublicKey);
    const orders: Order[] = [];

    for (const id of allIds) {
      try {
        const order = await getOrderById(traderPublicKey, id);
        if (order && order.trader === traderPublicKey) {
          orders.push(order);
        }
      } catch {
        // Order might have been executed/cancelled
      }
    }

    return orders;
  } catch (error) {
    console.error('Error fetching orders:', error);
    return [];
  }
}

/**
 * Get all pending order IDs (for orderbook) - read-only
 */
export async function getAllOrderIds(publicKey: string): Promise<number[]> {
  try {
    const result = await sorobanRpc.simulateTransaction(
      await buildSimulateTransaction(publicKey, 'get_all_order_ids', [])
    );

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      const ids = scValToNative(result.result.retval) as (number | bigint)[];
      return ids.map(id => Number(id));
    }

    return [];
  } catch (error) {
    console.error('Error fetching all order IDs:', error);
    return [];
  }
}

/**
 * Get a specific order by ID (read-only)
 */
export async function getOrderById(publicKey: string, orderId: number): Promise<Order | null> {
  try {
    const args = [toScVal(orderId, 'u64')];

    const result = await sorobanRpc.simulateTransaction(
      await buildSimulateTransaction(publicKey, 'get_order', args)
    );

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      const rawOrder = scValToNative(result.result.retval) as RawOrder | null;
      return rawOrder ? parseOrder(rawOrder) : null;
    }

    return null;
  } catch (error) {
    console.error('Error fetching order:', error);
    return null;
  }
}

/**
 * Get all pending orders for orderbook (read-only)
 * Fetches all order IDs and then fetches each order's details
 */
export async function getAllPendingOrders(publicKey: string): Promise<Order[]> {
  try {
    const orderIds = await getAllOrderIds(publicKey);
    console.log('[DEBUG] All order IDs:', orderIds);

    if (orderIds.length === 0) return [];

    // Fetch all orders in parallel
    const orderPromises = orderIds.map(id => getOrderById(publicKey, id));
    const orders = await Promise.all(orderPromises);

    // Filter out nulls and only return pending orders
    return orders.filter((order): order is Order =>
      order !== null && order.status === 'Pending'
    );
  } catch (error) {
    console.error('Error fetching all pending orders:', error);
    return [];
  }
}

/**
 * Get stop-loss order for a position.
 * Searches through trader's orders since per-position SL/TP view was removed.
 */
export async function getPositionStopLoss(
  publicKey: string,
  positionId: number
): Promise<Order | null> {
  try {
    const orders = await getOrders(publicKey);
    return orders.find(o =>
      o.orderType === 'StopLoss' && o.positionId === positionId && o.status === 'Pending'
    ) || null;
  } catch {
    return null;
  }
}

/**
 * Get take-profit order for a position.
 * Searches through trader's orders since per-position SL/TP view was removed.
 */
export async function getPositionTakeProfit(
  publicKey: string,
  positionId: number
): Promise<Order | null> {
  try {
    const orders = await getOrders(publicKey);
    return orders.find(o =>
      o.orderType === 'TakeProfit' && o.positionId === positionId && o.status === 'Pending'
    ) || null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Trade History Functions
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Cross-Margin Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deposit USDC into cross-margin pool
 */
export async function depositCrossMargin(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  amount: bigint
): Promise<void> {
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(amount, 'i128'),
  ];

  const xdrStr = await buildTransaction(signerPublicKey, marketContract, 'deposit_cross_margin', args);
  const signedXdr = await signTransaction(xdrStr);
  await submitTransaction(signedXdr);
}

/**
 * Withdraw USDC from cross-margin pool
 */
export async function withdrawCrossMargin(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  amount: bigint
): Promise<void> {
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(amount, 'i128'),
  ];

  const xdrStr = await buildTransaction(signerPublicKey, marketContract, 'withdraw_cross_margin', args);
  const signedXdr = await signTransaction(xdrStr);
  await submitTransaction(signedXdr);
}

/**
 * Open a cross-margin position (uses shared collateral pool)
 */
export async function openPositionCross(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  params: {
    asset: string;
    collateral: bigint;
    leverage: number;
    direction: Direction;
  }
): Promise<Position> {
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(params.asset, 'symbol'),
    toScVal(params.collateral, 'i128'),
    toScVal(params.leverage, 'u32'),
    toScVal(params.direction, 'direction'),
  ];

  const xdrStr = await buildTransaction(signerPublicKey, marketContract, 'open_position_cross', args);
  const signedXdr = await signTransaction(xdrStr);
  const result = await submitTransaction(signedXdr);

  if (result.status === 'SUCCESS' && result.returnValue) {
    return scValToNative(result.returnValue) as Position;
  }
  throw new Error('Failed to open cross-margin position');
}

/**
 * Close a cross-margin position (PnL returns to pool)
 */
export async function closePositionCross(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  positionId: number
): Promise<{ pnl: bigint }> {
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(positionId, 'u64'),
  ];

  const xdrStr = await buildTransaction(signerPublicKey, marketContract, 'close_position_cross', args);
  const signedXdr = await signTransaction(xdrStr);
  const result = await submitTransaction(signedXdr);

  if (result.status === 'SUCCESS' && result.returnValue) {
    return { pnl: scValToNative(result.returnValue) as bigint };
  }
  throw new Error('Failed to close cross-margin position');
}

/**
 * Get cross-margin balance for a trader (read-only)
 */
export async function getCrossMarginBalance(traderPublicKey: string): Promise<bigint> {
  try {
    const args = [toScVal(traderPublicKey, 'address')];
    const result = await sorobanRpc.simulateTransaction(
      await buildSimulateTransaction(traderPublicKey, 'get_cross_margin_balance', args)
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
 * Get cross-margin position IDs for a trader (read-only)
 */
export async function getCrossMarginPositions(traderPublicKey: string): Promise<number[]> {
  try {
    const args = [toScVal(traderPublicKey, 'address')];
    const result = await sorobanRpc.simulateTransaction(
      await buildSimulateTransaction(traderPublicKey, 'get_cross_margin_positions', args)
    );

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      const ids = scValToNative(result.result.retval) as (number | bigint)[];
      return ids.map(id => Number(id));
    }
    return [];
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Advanced Order Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Place a stop-limit order (two-phase: stop triggers, then limit activates)
 */
export async function placeStopLimitOrder(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  params: {
    asset: string;
    direction: Direction;
    collateral: bigint;
    leverage: number;
    triggerPrice: bigint;
    limitPrice: bigint;
    triggerAbove: boolean;
    slippageToleranceBps: number;
    timeInForce?: number;
  }
): Promise<Order> {
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(params.asset, 'symbol'),
    toScVal(params.direction, 'direction'),
    toScVal(params.collateral, 'i128'),
    toScVal(params.leverage, 'u32'),
    toScVal(params.triggerPrice, 'i128'),
    toScVal(params.limitPrice, 'i128'),
    toScVal(params.triggerAbove, 'bool'),
    toScVal(params.slippageToleranceBps, 'u32'),
    toScVal(params.timeInForce ?? 0, 'u32'),
  ];

  const xdrStr = await buildTransaction(signerPublicKey, marketContract, 'place_stop_limit_order', args);
  const signedXdr = await signTransaction(xdrStr);
  const result = await submitTransaction(signedXdr);

  if (result.status === 'SUCCESS' && result.returnValue) {
    return scValToNative(result.returnValue) as Order;
  }
  throw new Error('Failed to place stop-limit order');
}

/**
 * Place a trailing stop order (tracks peak price, triggers at % drop)
 */
export async function placeTrailingStop(
  signerPublicKey: string,
  signTransaction: (xdr: string) => Promise<string>,
  params: {
    positionId: number;
    trailingPercentBps: number;
    slippageToleranceBps: number;
  }
): Promise<Order> {
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(params.positionId, 'u64'),
    toScVal(params.trailingPercentBps, 'u32'),
    toScVal(params.slippageToleranceBps, 'u32'),
  ];

  const xdrStr = await buildTransaction(signerPublicKey, marketContract, 'place_trailing_stop', args);
  const signedXdr = await signTransaction(xdrStr);
  const result = await submitTransaction(signedXdr);

  if (result.status === 'SUCCESS' && result.returnValue) {
    return scValToNative(result.returnValue) as Order;
  }
  throw new Error('Failed to place trailing stop');
}

// ═══════════════════════════════════════════════════════════════════════════
// Fee Tier Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get trader's fee tier info by reading volume record from contract storage.
 * Calculates tier client-side using the known tier thresholds.
 */
export async function getTraderFeeInfo(traderPublicKey: string): Promise<{
  volume14d: bigint;
  tier: number;
  tierName: string;
  makerFeeBps: number;
  takerFeeBps: number;
  nextTierVolume: bigint;
  nextTierName: string;
} | null> {
  const { FEE_TIERS } = await import('@/lib/utils/constants');
  const PRECISION_VAL = BigInt(10_000_000);

  let volume14d = BigInt(0);

  try {
    // Try reading trader volume from contract via get_trader_volume view
    const args = [toScVal(traderPublicKey, 'address')];
    const xdrStr = await buildTransaction(traderPublicKey, marketContract, 'get_trader_volume', args);
    // Simulate only (read-only call)
    const server = new rpc.Server(NETWORK.RPC_URL);
    const tx = new (await import('@stellar/stellar-sdk')).Transaction(xdrStr, NETWORK.PASSPHRASE);
    const simResult = await server.simulateTransaction(tx);
    if ('result' in simResult && simResult.result) {
      const rawVolume = scValToNative((simResult.result as any).retval);
      volume14d = BigInt(rawVolume);
    }
  } catch {
    // get_trader_volume may not exist (removed for WASM size)
    // Fall back to default tier 0
    volume14d = BigInt(0);
  }

  // Convert volume from precision to USD
  const volumeUsd = Number(volume14d) / Number(PRECISION_VAL);

  // Determine tier
  let tierIndex = 0;
  for (let i = FEE_TIERS.length - 1; i >= 0; i--) {
    if (volumeUsd >= FEE_TIERS[i].minVolume) {
      tierIndex = i;
      break;
    }
  }

  const currentTier = FEE_TIERS[tierIndex];
  const nextTier = tierIndex < FEE_TIERS.length - 1 ? FEE_TIERS[tierIndex + 1] : null;

  return {
    volume14d,
    tier: tierIndex,
    tierName: currentTier.name,
    makerFeeBps: currentTier.makerBps,
    takerFeeBps: currentTier.takerBps,
    nextTierVolume: nextTier ? BigInt(Math.round(nextTier.minVolume * Number(PRECISION_VAL))) : BigInt(0),
    nextTierName: nextTier ? nextTier.name : 'Max',
  };
}
