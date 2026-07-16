import { marketContract, routerContract, buildTransaction, submitTransaction, toScVal, rpc as sorobanRpc } from './client';
import { fetchAttestation, priceTailArgs } from './noeracle';
import type { Position, DisplayPosition, MarketConfig, Direction, Trade, Order, DisplayOrder, OrderType, TriggerCondition, OrderStatus } from '@/types';
import { fromPrecision, calculatePnL } from '@/lib/utils/format';
import { rpc, scValToNative, xdr, Horizon, Address } from '@stellar/stellar-sdk';
import { CONTRACTS, NETWORK } from '@/lib/utils/constants';
import { debugLog } from '@/lib/utils/debug';

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
  /** Unix seconds when opened. Current struct calls it `timestamp`. */
  timestamp?: number | bigint;
  /** Cumulative funding index snapshot at open (PRECISION-scaled). */
  entry_cumulative_funding?: bigint;
  /** Legacy field names from the pre-cumulative-funding struct — kept so a
   *  stale deployment can't NaN the parse. */
  opened_at?: number | bigint;
  accumulated_funding?: bigint;
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
    // The deployed struct's field is `timestamp`; the old parser read the
    // long-renamed `opened_at`, silently producing Invalid Dates.
    openedAt: Number(raw.timestamp ?? raw.opened_at ?? 0),
    entryCumulativeFunding: BigInt(raw.entry_cumulative_funding ?? raw.accumulated_funding ?? 0),
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
  debugLog('[DEBUG] Opening position...');

  // Trade args, shared by the direct and router paths. Matches:
  // open_position(trader: Address, asset: Symbol, collateral: i128, leverage: u32, direction: Direction)
  const tradeArgs = [
    toScVal(signerPublicKey, 'address'),    // trader: Address
    toScVal(params.asset, 'symbol'),        // asset: Symbol (e.g., "XLM", "BTC")
    toScVal(params.collateral, 'i128'),     // collateral: i128 (7 decimals)
    toScVal(params.leverage, 'u32'),        // leverage: u32 (1-10)
    toScVal(params.direction, 'direction'), // direction: Direction enum (Long=0, Short=1)
  ];

  let xdrStr: string;
  if (routerContract) {
    // Router path (Pattern B): fetch a fresh signed Noeracle price and open
    // atomically via noether_router.open_with_price, so the market reads a
    // sub-second-fresh price and can't reject with #30 PriceStale.
    // NOTE: runtime-unverified until the router is deployed and
    // NEXT_PUBLIC_NOETHER_ROUTER_ID is set — the wallet signs the full
    // router -> market.open_position -> USDC transfer auth tree.
    const att = await fetchAttestation(params.asset);
    if (!att) throw new Error('Noeracle price unavailable — cannot open position');
    xdrStr = await buildTransaction(
      signerPublicKey,
      routerContract,
      'open_with_price',
      [...tradeArgs, ...priceTailArgs(att)],
    );
  } else {
    // Direct path (default): straight to the market, which reads the cached
    // oracle through oracle_adapter.
    xdrStr = await buildTransaction(signerPublicKey, marketContract, 'open_position', tradeArgs);
  }

  const signedXdr = await signTransaction(xdrStr);
  const result = await submitTransaction(signedXdr);

  if (result.status === 'SUCCESS' && result.returnValue) {
    debugLog('[DEBUG] Position opened successfully!');
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
  positionId: number,
  asset: string,
): Promise<{ pnl: bigint; fee: bigint }> {
  debugLog('[DEBUG] Closing position...');

  let xdrStr: string;
  if (routerContract) {
    // Router path (Pattern B): mirror openPosition — fetch a fresh signed
    // Noeracle price and close atomically via noether_router.close_with_price,
    // so the market reads a sub-second-fresh price for `asset` and can't
    // reject with #30 PriceStale (oracle_adapter no longer exists).
    // close_with_price(trader, position_id, asset, price, timestamp, round_id, pubkeys, sigs) -> i128 pnl
    const att = await fetchAttestation(asset);
    if (!att) throw new Error('Noeracle price unavailable — cannot close position');
    xdrStr = await buildTransaction(
      signerPublicKey,
      routerContract,
      'close_with_price',
      [
        toScVal(signerPublicKey, 'address'), // trader: Address
        toScVal(positionId, 'u64'),          // position_id: u64
        toScVal(asset, 'symbol'),            // asset: Symbol
        ...priceTailArgs(att),
      ],
    );
  } else {
    // Direct path (default): close_position(trader: Address, position_id: u64)
    const args = [
      toScVal(signerPublicKey, 'address'),  // trader: Address
      toScVal(positionId, 'u64'),            // position_id: u64 (not u32!)
    ];
    xdrStr = await buildTransaction(signerPublicKey, marketContract, 'close_position', args);
  }

  const signedXdr = await signTransaction(xdrStr);
  const result = await submitTransaction(signedXdr);

  if (result.status === 'SUCCESS' && result.returnValue) {
    debugLog('[DEBUG] Position closed successfully!');
    const native = scValToNative(result.returnValue);
    // Direct close_position returns { pnl, fee }; router close_with_price
    // returns a bare i128 pnl. Normalise to the same shape for callers.
    if (typeof native === 'bigint') {
      return { pnl: native, fee: BigInt(0) };
    }
    return native as { pnl: bigint; fee: bigint };
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
 * Hydrate a specific set of position IDs (read-only).
 * Used by leader mode, which gets the open-position ids for the vault
 * factory contract from the indexer-backed /v1/positions/open API and
 * then only needs to pull on-chain detail for *that* short list — far
 * cheaper than scanning every market position id with get_all_position_ids.
 */
export async function getPositionsByIds(
  source: string,
  positionIds: number[],
): Promise<Position[]> {
  if (positionIds.length === 0) return [];
  const positions: Position[] = [];
  await Promise.all(
    positionIds.map(async (id) => {
      try {
        const args = [toScVal(id, 'u64')];
        const posResult = await sorobanRpc.simulateTransaction(
          await buildSimulateTransaction(source, 'get_position', args),
        );
        if (rpc.Api.isSimulationSuccess(posResult) && posResult.result?.retval) {
          const raw = scValToNative(posResult.result.retval) as RawPosition | null;
          if (raw) positions.push(parsePosition(raw));
        }
      } catch {
        // Position closed between the indexer hint and now.
      }
    }),
  );
  return positions;
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
      // A failed read is NOT an empty account — throw so callers can keep
      // last-good rows and show an error instead of "No open positions".
      throw new Error('get_all_position_ids simulation failed');
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
    // Propagate: failure must stay distinguishable from "no positions".
    throw error instanceof Error ? error : new Error('Failed to fetch positions');
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
  const { TransactionBuilder, BASE_FEE, Account } = await import('@stellar/stellar-sdk');
  const { NETWORK } = await import('@/lib/utils/constants');

  // Locally-built Account with a dummy sequence: simulateTransaction ignores
  // sequence numbers (see the NULL_ACCOUNT note in constants.ts), so the
  // getAccount fetch this used to do was a wasted round-trip that DOUBLED
  // every read — and the per-id readers amplified it once per position/order.
  // Submission paths still fetch the real account in client.ts.
  const account = new Account(publicKey, '0');
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
  currentPrice: number,
  /** Current global cumulative funding index (PRECISION-scaled) — enables
   *  the per-position accrued-funding estimate (B4). null/omitted = unknown. */
  cumulativeFunding?: bigint | null
): DisplayPosition {
  const entryPrice = bigIntToNumber(position.entryPrice);
  const collateral = bigIntToNumber(position.collateral);
  const size = bigIntToNumber(position.size);
  const liquidationPrice = bigIntToNumber(position.liquidationPrice);
  const leverage = collateral > 0 ? size / collateral : 0;

  const isLong = position.direction === 'Long';
  // calculatePnL returns null when the mark price is unknown (0/NaN). An
  // unknown price must never render as a fabricated 0 or a −100% loss, so
  // propagate NaN — every format.ts helper renders NaN as '—'.
  const pnlResult = calculatePnL(entryPrice, currentPrice, size, isLong);

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
    pnl: pnlResult ? pnlResult.pnl : Number.NaN,
    pnlPercent: pnlResult ? pnlResult.pnlPercent : Number.NaN,
    leverage: isNaN(leverage) ? 0 : leverage,
    openedAt: new Date(position.openedAt * 1000),
    marginMode: position.marginMode || 'Isolated',
    // B4: mirrors the contract's close-time settlement —
    // calculate_cumulative_funding(size, direction, entry_snapshot, current).
    // Positive = the position PAYS this on close. null = index unknown.
    pendingFunding:
      cumulativeFunding == null
        ? null
        : (() => {
            const delta = cumulativeFunding - position.entryCumulativeFunding;
            // size(7dp) × delta(PRECISION-scaled) / PRECISION → 7dp USDC
            const raw = (position.size * delta) / 10_000_000n;
            const usd = Number(raw) / 10_000_000;
            return position.direction === 'Long' ? usd : -usd;
          })(),
  };
}

/**
 * Raw event data for position_closed from contract.
 * The DEPLOYED event has 8 fields — it does NOT emit fee or funding
 * (contracts/market/src/lib.rs:2052-2055). Fee emission ships with the
 * next contract deploy (roadmap C2); until then trade rows expose
 * `fee: undefined`, never a fabricated 0.
 */
interface RawPositionClosedEvent {
  0: number | bigint;  // position_id
  1: string;           // trader address
  2: string;           // asset (Symbol as string)
  3: number | { Long?: null; Short?: null };  // direction (0=Long, 1=Short or enum object)
  4: bigint;           // size
  5: bigint;           // entry_price
  6: bigint;           // exit_price (current_price)
  7: bigint;           // pnl
}

/**
 * Fetch trade history by querying Horizon for transactions and parsing Soroban events.
 * Parses successful transactions to find position_closed events from the Market contract.
 */
export async function getTradeHistory(traderPublicKey: string): Promise<Trade[]> {
  try {
    const trades: Trade[] = [];

    debugLog('[TradeHistory] Fetching for trader:', traderPublicKey);

    const horizonServer = new Horizon.Server(NETWORK.HORIZON_URL);

    // Fetch user's recent transactions (limit 100, ordered by most recent)
    const transactionsResponse = await horizonServer
      .transactions()
      .forAccount(traderPublicKey)
      .order('desc')
      .limit(100)
      .call();

    debugLog('[TradeHistory] Found', transactionsResponse.records.length, 'transactions');

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

    debugLog('[TradeHistory] Found', trades.length, 'trades from Horizon');

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
 * Deployed format (8 fields): (position_id, trader, asset, direction, size, entry_price, exit_price, pnl)
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
            // Parse event data — deployed 8-field format:
            // (position_id, trader, asset, direction, size, entry_price, exit_price, pnl)
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

            if (Array.isArray(eventData)) {
              // Array format: [position_id, trader, asset, direction, size, entry_price, exit_price, pnl]
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
              // The deployed event carries no fee — undefined renders '—', never a fabricated 0.
              fee: undefined,
              timestamp: new Date(tx.created_at),
            };
          } else if (firstTopic === 'position_liquidated') {
            // (position_id, trader, asset, direction, size, keeper_reward, current_price)
            const eventData = scValToNative(data);
            if (!Array.isArray(eventData)) continue;
            const trader = eventData[1] as string;
            if (trader !== traderPublicKey) continue;
            const dirVal = eventData[3];
            const direction: Direction =
              typeof dirVal === 'number'
                ? dirVal === 0 ? 'Long' : 'Short'
                : typeof dirVal === 'object' && dirVal !== null && 'Short' in dirVal
                ? 'Short'
                : 'Long';
            return {
              id: tx.id,
              txHash: tx.hash,
              trader,
              asset: String(eventData[2] ?? 'Unknown'),
              direction,
              type: 'liquidation',
              size: bigIntToNumber(BigInt(eventData[4] ?? 0)),
              price: bigIntToNumber(BigInt(eventData[6] ?? 0)),
              // Entry/PnL are NOT in the deployed event (C2 adds them) —
              // undefined renders '—', never a fabricated figure.
              entryPrice: undefined,
              pnl: undefined,
              fee: undefined,
              timestamp: new Date(tx.created_at),
            };
          } else if (firstTopic === 'cross_liq') {
            // (trader, total_pnl, keeper_reward) — one event for the whole
            // cross account; rendered as a single 'Cross account' row.
            const eventData = scValToNative(data);
            if (!Array.isArray(eventData)) continue;
            const trader = eventData[0] as string;
            if (trader !== traderPublicKey) continue;
            return {
              id: tx.id,
              txHash: tx.hash,
              trader,
              asset: 'CROSS',
              direction: 'Long',
              type: 'liquidation',
              size: 0,
              price: 0,
              entryPrice: undefined,
              pnl: bigIntToNumber(BigInt(eventData[1] ?? 0)),
              fee: undefined,
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

    debugLog(`[TradeHistory] Fetching events from ledger ${startLedger} to ${latestLedger.sequence}`);

    // Closes AND liquidations — a liquidated trader must find the record
    // in their history, not a silent gap (B1).
    const response = await sorobanRpc.getEvents({
      startLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [CONTRACTS.MARKET],
          topics: [[xdr.ScVal.scvSymbol('position_closed').toXDR('base64')]],
        },
        {
          type: 'contract',
          contractIds: [CONTRACTS.MARKET],
          topics: [[xdr.ScVal.scvSymbol('position_liquidated').toXDR('base64')]],
        },
        {
          type: 'contract',
          contractIds: [CONTRACTS.MARKET],
          topics: [[xdr.ScVal.scvSymbol('cross_liq').toXDR('base64')]],
        },
      ],
      limit: 100,
    });

    if (!response.events || response.events.length === 0) {
      debugLog('[TradeHistory] No close/liquidation events found');
      return [];
    }

    debugLog(`[TradeHistory] Found ${response.events.length} events`);
    return parseEventsToTrades(response.events, traderPublicKey);
  } catch (error) {
    console.error('Error fetching trade history from events:', error);
    return [];
  }
}

/** One recent liquidation touching the trader (B1 vanish-toast source). */
export interface RecentLiquidation {
  /** null = whole cross account was liquidated (cross_liq). */
  positionId: number | null;
  /** Liquidation price for isolated positions; 0 for cross events. */
  price: number;
  /** Total account PnL for cross liquidations; null for isolated. */
  totalPnl: number | null;
}

/**
 * Best-effort scan of recent position_liquidated / cross_liq events for one
 * trader, so the UI can say "Position #N liquidated at $X" when a row
 * vanishes between polls instead of deleting it silently (B1). Errors return
 * [] — no toast is better than a wrong toast.
 */
export async function getRecentLiquidations(
  traderPublicKey: string,
  lookbackLedgers = 240 // ≈ 20 minutes of ledgers
): Promise<RecentLiquidation[]> {
  try {
    const latestLedger = await sorobanRpc.getLatestLedger();
    const startLedger = Math.max(1, latestLedger.sequence - lookbackLedgers);
    const response = await sorobanRpc.getEvents({
      startLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [CONTRACTS.MARKET],
          topics: [[xdr.ScVal.scvSymbol('position_liquidated').toXDR('base64')]],
        },
        {
          type: 'contract',
          contractIds: [CONTRACTS.MARKET],
          topics: [[xdr.ScVal.scvSymbol('cross_liq').toXDR('base64')]],
        },
      ],
      limit: 50,
    });

    const out: RecentLiquidation[] = [];
    for (const event of response.events ?? []) {
      try {
        const topic = event.topic?.length ? String(scValToNative(event.topic[0])) : '';
        const data = scValToNative(event.value);
        if (!Array.isArray(data)) continue;
        if (topic === 'position_liquidated') {
          if ((data[1] as string) !== traderPublicKey) continue;
          out.push({
            positionId: Number(data[0]),
            price: bigIntToNumber(BigInt(data[6] ?? 0)),
            totalPnl: null,
          });
        } else if (topic === 'cross_liq') {
          if ((data[0] as string) !== traderPublicKey) continue;
          out.push({
            positionId: null,
            price: 0,
            totalPnl: bigIntToNumber(BigInt(data[1] ?? 0)),
          });
        }
      } catch {}
    }
    return out;
  } catch {
    return [];
  }
}

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

  // Decode time_in_force: bits 0-7 = TIF mode, bit 8 = reduce-only flag
  const tifMode = order.timeInForce & 0xFF;
  const tifMap: Record<number, 'GTC' | 'IOC' | 'PostOnly'> = { 0: 'GTC', 1: 'IOC', 2: 'PostOnly' };
  const timeInForce = tifMap[tifMode] || 'GTC';
  const reduceOnly = (order.timeInForce & 0x100) !== 0;

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
    timeInForce,
    reduceOnly,
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
  debugLog('[DEBUG] Placing limit order...');

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
    debugLog('[DEBUG] Limit order placed successfully!');
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
  debugLog('[DEBUG] Setting stop-loss for position:', params.positionId);

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
    debugLog('[DEBUG] Stop-loss set successfully!');
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
  debugLog('[DEBUG] Setting take-profit for position:', params.positionId);

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
    debugLog('[DEBUG] Take-profit set successfully!');
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
  debugLog('[DEBUG] Cancelling order:', orderId);

  // Contract signature: cancel_order(trader, order_id)
  const args = [
    toScVal(signerPublicKey, 'address'),
    toScVal(orderId, 'u64'),
  ];

  const xdrStr = await buildTransaction(signerPublicKey, marketContract, 'cancel_order', args);
  const signedXdr = await signTransaction(xdrStr);
  const result = await submitTransaction(signedXdr);

  if (result.status === 'SUCCESS') {
    debugLog('[DEBUG] Order cancelled successfully!');
    return;
  }

  throw new Error('Failed to cancel order');
}

/**
 * Get all orders for a trader (read-only).
 * Uses get_all_order_ids + get_order since get_orders was removed for WASM
 * size — the cost scales with EVERY order the market has stored, not the
 * trader's. FALLBACK path: the trade page prefers /v1/orders/open id-hints
 * + getOrdersByIds and only lands here when the gateway can't speak for
 * this market (see gatewayServesThisMarket).
 */
export async function getOrders(traderPublicKey: string): Promise<Order[]> {
  try {
    const allIds = await getAllOrderIds(traderPublicKey, true);
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
    // Propagate: failure must stay distinguishable from "no orders".
    throw error instanceof Error ? error : new Error('Failed to fetch orders');
  }
}

/**
 * Get all pending order IDs (for orderbook) - read-only.
 * `strict` makes a failed read THROW instead of returning [] — used by
 * getOrders so an RPC outage never masquerades as an empty account.
 */
export async function getAllOrderIds(publicKey: string, strict = false): Promise<number[]> {
  try {
    const result = await sorobanRpc.simulateTransaction(
      await buildSimulateTransaction(publicKey, 'get_all_order_ids', [])
    );

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      const ids = scValToNative(result.result.retval) as (number | bigint)[];
      return ids.map(id => Number(id));
    }

    if (strict) throw new Error('get_all_order_ids simulation failed');
    return [];
  } catch (error) {
    console.error('Error fetching all order IDs:', error);
    if (strict) throw error instanceof Error ? error : new Error('Failed to fetch order ids');
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
 * Hydrate a specific set of order IDs (read-only).
 * Mirrors getPositionsByIds: the indexer-backed /v1/orders/open endpoint
 * supplies WHICH ids belong to the trader (or are open market-wide) and only
 * those are read on-chain — replacing the get_all_order_ids + every-order
 * scan whose cost grew with the whole market's order history (P-1).
 * Ids that no longer resolve on-chain (pruned/just-executed) are dropped.
 */
export async function getOrdersByIds(source: string, orderIds: number[]): Promise<Order[]> {
  if (orderIds.length === 0) return [];
  const results = await Promise.all(orderIds.map((id) => getOrderById(source, id)));
  return results.filter((order): order is Order => order !== null);
}

/**
 * Get all pending orders for orderbook (read-only)
 * Fetches all order IDs and then fetches each order's details.
 * FALLBACK path — the order book prefers /v1/orders/open id-hints +
 * getOrdersByIds and only lands here when the gateway can't speak for
 * this market (see gatewayServesThisMarket).
 */
export async function getAllPendingOrders(publicKey: string): Promise<Order[]> {
  try {
    const orderIds = await getAllOrderIds(publicKey);
    debugLog('[DEBUG] All order IDs:', orderIds);

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

      // Dispatch by topic — the query returns closes AND liquidations (B1).
      let topicName = '';
      try {
        topicName = event.topic?.length ? String(scValToNative(event.topic[0])) : '';
      } catch {}

      if (topicName === 'position_liquidated') {
        // (position_id, trader, asset, direction, size, keeper_reward, current_price)
        if (!Array.isArray(data)) continue;
        const trader = data[1] as string;
        if (trader !== traderPublicKey) continue;
        const dirVal = data[3];
        const direction: Direction =
          typeof dirVal === 'number'
            ? dirVal === 0 ? 'Long' : 'Short'
            : typeof dirVal === 'object' && dirVal !== null && 'Short' in dirVal
            ? 'Short'
            : 'Long';
        trades.push({
          id: `${event.id}`,
          txHash: event.txHash,
          trader,
          asset: String(data[2] ?? 'Unknown'),
          direction,
          type: 'liquidation',
          size: bigIntToNumber(BigInt(data[4] ?? 0)),
          price: bigIntToNumber(BigInt(data[6] ?? 0)),
          // Entry/PnL are not in the deployed event (C2 adds them) — '—'.
          entryPrice: undefined,
          pnl: undefined,
          fee: undefined,
          timestamp: new Date(event.ledgerClosedAt || Date.now()),
        });
        continue;
      }

      if (topicName === 'cross_liq') {
        // (trader, total_pnl, keeper_reward)
        if (!Array.isArray(data)) continue;
        const trader = data[0] as string;
        if (trader !== traderPublicKey) continue;
        trades.push({
          id: `${event.id}`,
          txHash: event.txHash,
          trader,
          asset: 'CROSS',
          direction: 'Long',
          type: 'liquidation',
          size: 0,
          price: 0,
          entryPrice: undefined,
          pnl: bigIntToNumber(BigInt(data[1] ?? 0)),
          fee: undefined,
          timestamp: new Date(event.ledgerClosedAt || Date.now()),
        });
        continue;
      }

      // Extract fields from the NEW event format
      let trader: string = traderPublicKey;
      let asset: string = 'Unknown';
      let direction: Direction = 'Long';
      let size: bigint = BigInt(0);
      let entryPrice: bigint = BigInt(0);
      let exitPrice: bigint = BigInt(0);
      let pnl: bigint = BigInt(0);

      if (Array.isArray(data)) {
        // Format: [position_id, trader, asset, direction, size, entry_price, current_price, pnl]
        trader = data[1] as string;
        asset = String(data[2] || 'Unknown');
        const dirVal = data[3];
        if (typeof dirVal === 'number') {
          direction = dirVal === 0 ? 'Long' : 'Short';
        } else if (typeof dirVal === 'object' && dirVal !== null) {
          direction = 'Long' in dirVal ? 'Long' : 'Short';
        }
        size = BigInt(data[4] ?? 0);
        entryPrice = BigInt(data[5] ?? 0);
        exitPrice = BigInt(data[6] ?? 0);
        pnl = BigInt(data[7] ?? 0);
      } else if (typeof data === 'object' && data !== null) {
        const obj = data as Record<string, unknown>;
        trader = (obj[1] || obj.trader || '') as string;
        asset = String(obj[2] || obj.asset || 'Unknown');
        const dirVal = obj[3] || obj.direction;
        if (typeof dirVal === 'number') {
          direction = dirVal === 0 ? 'Long' : 'Short';
        } else if (typeof dirVal === 'object' && dirVal !== null) {
          direction = 'Long' in (dirVal as object) ? 'Long' : 'Short';
        }
        size = BigInt((obj[4] || obj.size || 0) as number | bigint);
        entryPrice = BigInt((obj[5] || obj.entry_price || 0) as number | bigint);
        exitPrice = BigInt((obj[6] || obj.exit_price || 0) as number | bigint);
        pnl = BigInt((obj[7] || obj.pnl || 0) as number | bigint);
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
        // No fee in the deployed event — undefined renders '—', never a fabricated 0.
        fee: undefined,
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
export async function getCrossMarginBalance(traderPublicKey: string): Promise<bigint | null> {
  try {
    const args = [toScVal(traderPublicKey, 'address')];
    const result = await sorobanRpc.simulateTransaction(
      await buildSimulateTransaction(traderPublicKey, 'get_cross_margin_balance', args)
    );

    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      return scValToNative(result.result.retval) as bigint;
    }
    // Read failed / sim non-success: unknown, not zero — callers render '—'.
    return null;
  } catch {
    return null;
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
 * Returns null when the volume cannot be read (get_trader_volume was removed
 * from the deployed WASM for size) — callers must treat the tier as UNKNOWN
 * and hide tier UI rather than asserting "Base". The real fix is the
 * indexer-backed per-trader volume endpoint (roadmap B5).
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
    } else {
      return null;
    }
  } catch {
    // Volume unknown (view removed for WASM size / RPC failure) — never
    // report a fabricated tier-0 record.
    return null;
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

/**
 * Get current funding rate by reading contract storage directly via RPC.
 * Returns the rate as a percentage (e.g., 0.005 for 0.005% per hour).
 * Positive = longs pay shorts, negative = shorts pay longs.
 * Returns null when the rate is unknown (RPC failure or the storage entry
 * is absent) — callers must render '—', never a healthy-looking 0.
 */
/**
 * Read the global cumulative funding index (PRECISION-scaled i128) straight
 * from contract storage. Positions snapshot this at open; pending funding =
 * size × (current − snapshot) / PRECISION, signed by direction (B4).
 * Returns null when unknown — callers render '—', never assert 0.
 */
export async function getCumulativeFundingRate(): Promise<bigint | null> {
  try {
    const key = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: new Address(CONTRACTS.MARKET).toScAddress(),
        key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('CumulativeFundingRate')]),
        durability: xdr.ContractDataDurability.persistent(),
      })
    );

    const entries = await sorobanRpc.getLedgerEntries(key);
    if (entries.entries && entries.entries.length > 0) {
      const val = scValToNative(entries.entries[0].val.contractData().val());
      return typeof val === 'bigint' ? val : BigInt(Number(val));
    }
    // Entry absent = funding has never accrued — the index is genuinely 0.
    return 0n;
  } catch {
    return null;
  }
}

export async function getFundingRate(): Promise<number | null> {
  try {
    const PRECISION = 10_000_000;
    const key = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: new Address(CONTRACTS.MARKET).toScAddress(),
        key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('CurrentFundingRate')]),
        durability: xdr.ContractDataDurability.persistent(),
      })
    );

    const entries = await sorobanRpc.getLedgerEntries(key);
    if (entries.entries && entries.entries.length > 0) {
      const val = scValToNative(entries.entries[0].val.contractData().val());
      const rate = typeof val === 'bigint' ? Number(val) : Number(val);
      return (rate / PRECISION) * 100; // Convert to percentage
    }
    return null;
  } catch {
    return null;
  }
}
