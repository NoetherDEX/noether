import { marketContract, toScVal, rpc as sorobanRpc } from './client';
import { getPrice, priceToDisplay } from './oracle';
import { calculatePnL } from '@/lib/utils/format';
import { rpc, scValToNative, xdr, TransactionBuilder, BASE_FEE } from '@stellar/stellar-sdk';
import { CONTRACTS, NETWORK, TRADING } from '@/lib/utils/constants';

export interface LeaderboardTrader {
  address: string;
  openPositions: number;
  totalVolume: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  tradeCount: number;
}

interface RawPosition {
  id: number | bigint;
  trader: string;
  asset: string;
  direction: number | bigint;
  collateral: bigint;
  size: bigint;
  entry_price: bigint;
  liquidation_price: bigint;
  opened_at: number | bigint;
  last_funding_at: number | bigint;
  accumulated_funding: bigint;
}

function bigIntToNumber(value: bigint | number | undefined, decimals = 7): number {
  if (value === undefined || value === null) return 0;
  const num = typeof value === 'bigint' ? Number(value) : value;
  if (isNaN(num)) return 0;
  return num / Math.pow(10, decimals);
}

/** Build a simulated (read-only) transaction for the market contract */
async function buildSimulate(publicKey: string, method: string, args: xdr.ScVal[]) {
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

/** Get all open position IDs from the market contract */
async function getAllPositionIds(callerPublicKey: string): Promise<number[]> {
  try {
    const result = await sorobanRpc.simulateTransaction(
      await buildSimulate(callerPublicKey, 'get_all_position_ids', [])
    );
    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      const ids = scValToNative(result.result.retval) as (number | bigint)[];
      return ids.map(Number);
    }
    return [];
  } catch (error) {
    console.error('[Leaderboard] Error fetching position IDs:', error);
    return [];
  }
}

/** Get a single position by ID */
async function getPositionById(callerPublicKey: string, positionId: number): Promise<RawPosition | null> {
  try {
    const args = [toScVal(positionId, 'u64')];
    const result = await sorobanRpc.simulateTransaction(
      await buildSimulate(callerPublicKey, 'get_position', args)
    );
    if (rpc.Api.isSimulationSuccess(result) && result.result?.retval) {
      return scValToNative(result.result.retval) as RawPosition;
    }
    return null;
  } catch {
    return null;
  }
}

/** Fetch all position_closed events from Soroban RPC (not filtered by trader) */
async function getAllClosedTradeEvents(): Promise<{ trader: string; pnl: number; volume: number }[]> {
  try {
    const latestLedger = await sorobanRpc.getLatestLedger();
    const LOOKBACK_LEDGERS = 10000;
    const startLedger = Math.max(latestLedger.sequence - LOOKBACK_LEDGERS, 1);

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
      limit: 200,
    });

    if (!response.events || response.events.length === 0) {
      return [];
    }

    const trades: { trader: string; pnl: number; volume: number }[] = [];

    for (const event of response.events) {
      try {
        const data = scValToNative(event.value);
        let trader = '';
        let pnl = BigInt(0);
        let size = BigInt(0);

        if (Array.isArray(data)) {
          trader = data[1] as string;
          size = data[4] as bigint;
          pnl = data[7] as bigint;
        } else if (typeof data === 'object' && data !== null) {
          const obj = data as Record<string, unknown>;
          trader = (obj[1] || obj.trader || '') as string;
          size = (obj[4] || obj.size || BigInt(0)) as bigint;
          pnl = (obj[7] || obj.pnl || BigInt(0)) as bigint;
        }

        if (trader) {
          trades.push({
            trader,
            pnl: bigIntToNumber(pnl),
            volume: bigIntToNumber(size),
          });
        }
      } catch {
        // skip malformed events
      }
    }

    return trades;
  } catch (error) {
    console.error('[Leaderboard] Error fetching closed events:', error);
    return [];
  }
}

/**
 * Main leaderboard data fetcher.
 * Fetches all open positions + closed trade events and aggregates by trader.
 */
export async function getLeaderboardData(callerPublicKey: string): Promise<LeaderboardTrader[]> {
  console.log('[Leaderboard] Fetching leaderboard data...');

  // 1. Get all open position IDs
  const positionIds = await getAllPositionIds(callerPublicKey);
  console.log(`[Leaderboard] Found ${positionIds.length} open positions`);

  // 2. Fetch each position (batch — up to 50 for performance)
  const batchIds = positionIds.slice(0, 50);
  const positions = (await Promise.all(
    batchIds.map(id => getPositionById(callerPublicKey, id))
  )).filter((p): p is RawPosition => p !== null);

  // 3. Collect unique assets and fetch prices
  const assets = Array.from(new Set(positions.map(p => p.asset)));
  const priceMap: Record<string, number> = {};

  for (const asset of assets) {
    try {
      const priceData = await getPrice(callerPublicKey, asset);
      if (priceData && priceData.price) {
        priceMap[asset] = priceToDisplay(priceData.price as unknown as bigint);
      }
    } catch {
      // skip
    }
  }

  // 4. Group open positions by trader and calculate unrealized PnL
  const traderMap = new Map<string, {
    openPositions: number;
    unrealizedPnl: number;
    openVolume: number;
    openTradeCount: number;
  }>();

  for (const pos of positions) {
    const trader = pos.trader;
    const entry = traderMap.get(trader) || { openPositions: 0, unrealizedPnl: 0, openVolume: 0, openTradeCount: 0 };

    const entryPrice = bigIntToNumber(pos.entry_price);
    const size = bigIntToNumber(pos.size);
    const currentPrice = priceMap[pos.asset] || 0;
    const isLong = Number(pos.direction) === 0;

    entry.openPositions += 1;
    entry.openVolume += size;
    entry.openTradeCount += 1;

    if (currentPrice > 0 && entryPrice > 0) {
      const { pnl } = calculatePnL(entryPrice, currentPrice, size, isLong);
      entry.unrealizedPnl += isNaN(pnl) ? 0 : pnl;
    }

    traderMap.set(trader, entry);
  }

  // 5. Fetch closed trade events and aggregate realized PnL
  const closedTrades = await getAllClosedTradeEvents();
  const closedMap = new Map<string, { realizedPnl: number; volume: number; count: number }>();

  for (const trade of closedTrades) {
    const entry = closedMap.get(trade.trader) || { realizedPnl: 0, volume: 0, count: 0 };
    entry.realizedPnl += trade.pnl;
    entry.volume += trade.volume;
    entry.count += 1;
    closedMap.set(trade.trader, entry);
  }

  // 6. Combine all traders
  const allTraderAddresses = Array.from(new Set(
    Array.from(traderMap.keys()).concat(Array.from(closedMap.keys()))
  ));
  const leaderboard: LeaderboardTrader[] = [];

  for (const address of allTraderAddresses) {
    const open = traderMap.get(address) || { openPositions: 0, unrealizedPnl: 0, openVolume: 0, openTradeCount: 0 };
    const closed = closedMap.get(address) || { realizedPnl: 0, volume: 0, count: 0 };

    leaderboard.push({
      address,
      openPositions: open.openPositions,
      totalVolume: open.openVolume + closed.volume,
      realizedPnl: closed.realizedPnl,
      unrealizedPnl: open.unrealizedPnl,
      totalPnl: closed.realizedPnl + open.unrealizedPnl,
      tradeCount: open.openTradeCount + closed.count,
    });
  }

  // 7. Sort by total PnL descending
  leaderboard.sort((a, b) => b.totalPnl - a.totalPnl);

  console.log(`[Leaderboard] Built leaderboard with ${leaderboard.length} traders`);
  return leaderboard;
}
