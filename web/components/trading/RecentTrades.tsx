'use client';

import { useState, useEffect, useCallback } from 'react';
import { Skeleton } from '@/components/ui';
import { NETWORK, CONTRACTS } from '@/lib/utils/constants';
import { cn } from '@/lib/utils/cn';
import { formatUSD } from '@/lib/utils';
import { rpc, xdr, scValToNative } from '@stellar/stellar-sdk';

interface GlobalTrade {
  id: string;
  asset: string;
  side: 'Long' | 'Short' | 'Close' | 'Liq';
  size: number;
  timestamp: Date;
  txHash: string;
}

// Compact relative time format
function formatCompactTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();

  if (diff < 0) return 'now';
  if (diff < 60000) return `${Math.max(1, Math.floor(diff / 1000))}s`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

// Side color mapping
const sideColors: Record<GlobalTrade['side'], string> = {
  Long: 'text-emerald-400',
  Short: 'text-red-400',
  Close: 'text-white',
  Liq: 'text-amber-400',
};

// Safely convert BigInt to number with precision (7 decimals)
function bigIntToNumber(value: bigint | number | undefined, decimals = 7): number {
  if (value === undefined || value === null) return 0;
  const num = typeof value === 'bigint' ? Number(value) : value;
  if (isNaN(num)) return 0;
  return num / Math.pow(10, decimals);
}

// Parse direction from contract format
function parseDirection(dirVal: unknown): 'Long' | 'Short' {
  if (typeof dirVal === 'number') {
    return dirVal === 0 ? 'Long' : 'Short';
  } else if (typeof dirVal === 'object' && dirVal !== null) {
    return 'Long' in dirVal ? 'Long' : 'Short';
  }
  return 'Long';
}

// Create Soroban RPC client
const sorobanRpc = new rpc.Server(NETWORK.RPC_URL);

export function RecentTradesSkeleton() {
  return (
    <div className="space-y-1">
      {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <div key={i} className="flex items-center justify-between py-1.5 px-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-3 w-10" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-6" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RecentTrades() {
  const [trades, setTrades] = useState<GlobalTrade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Honest liveness (A14): timestamp of the last SUCCESSFUL poll (null until
  // one lands) + whether the most recent poll failed. Rendered as
  // "Updated Xs ago" — never a permanent LIVE pulse the data can't back.
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [, setNowTick] = useState(0); // 1s re-render tick for relative times

  // Parse a single event into a GlobalTrade
  const parseEventToTrade = useCallback((
    event: rpc.Api.EventResponse,
    eventType: 'position_opened' | 'position_closed' | 'position_liquidated'
  ): GlobalTrade | null => {
    try {
      if (!event.value) return null;

      const data = scValToNative(event.value);

      let asset = 'BTC';
      let size = 0;
      let side: GlobalTrade['side'] = 'Long';

      if (Array.isArray(data)) {
        if (eventType === 'position_opened') {
          // Contract event: (position_id, trader, asset, direction, size, entry_price)
          asset = String(data[2] || 'BTC').toUpperCase();
          const dirVal = data[3];
          if (typeof dirVal === 'number') {
            side = dirVal === 0 ? 'Long' : 'Short';
          } else if (typeof dirVal === 'object' && dirVal !== null) {
            side = 'Long' in dirVal ? 'Long' : 'Short';
          }
          size = bigIntToNumber(data[4] as bigint);
        } else if (eventType === 'position_closed') {
          // Contract event: (position_id, trader, asset, direction, size, entry_price, current_price, pnl)
          asset = String(data[2] || 'BTC').toUpperCase();
          size = bigIntToNumber(data[4] as bigint);
          side = 'Close';
        } else if (eventType === 'position_liquidated') {
          // Contract event: (position_id, trader, asset, direction, size, keeper_reward, current_price)
          asset = String(data[2] || 'BTC').toUpperCase();
          size = bigIntToNumber(data[4] as bigint);
          side = 'Liq';
        }
      }

      // Validate asset name
      if (asset.length > 5) asset = 'BTC';

      if (size <= 0) return null;

      return {
        id: event.id,
        asset,
        side,
        size,
        timestamp: new Date(event.ledgerClosedAt || Date.now()),
        txHash: event.txHash,
      };
    } catch (error) {
      console.error('[RecentTrades] Failed to parse event:', error);
      return null;
    }
  }, []);

  // Fetch events for a specific event type using Soroban RPC
  const fetchEventsForType = useCallback(async (
    startLedger: number,
    eventType: 'position_opened' | 'position_closed' | 'position_liquidated'
  ): Promise<GlobalTrade[]> => {
    try {
      const response = await sorobanRpc.getEvents({
        startLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [CONTRACTS.MARKET],
            topics: [
              [xdr.ScVal.scvSymbol(eventType).toXDR('base64')],
            ],
          },
        ],
        limit: 50,
      });

      if (!response.events || response.events.length === 0) {
        return [];
      }

      const trades: GlobalTrade[] = [];
      for (const event of response.events) {
        const trade = parseEventToTrade(event, eventType);
        if (trade) {
          trades.push(trade);
        }
      }

      return trades;
    } catch (error) {
      // Rethrow so the poll marks itself failed — an RPC error must render
      // as an error/stale state, not as a fake-empty "No trades yet".
      console.error(`[RecentTrades] Failed to fetch ${eventType} events:`, error);
      throw error;
    }
  }, [parseEventToTrade]);

  // Fetch all recent trades from the Market contract
  const fetchRecentTrades = useCallback(async () => {
    try {
      // Get latest ledger to calculate start ledger
      const latestLedger = await sorobanRpc.getLatestLedger();

      // Use same lookback as Trade History (10000 ledgers = ~14 hours)
      const LOOKBACK_LEDGERS = 10000;
      const startLedger = Math.max(1, latestLedger.sequence - LOOKBACK_LEDGERS);

      // Fetch all three event types in parallel
      const [openedTrades, closedTrades, liquidatedTrades] = await Promise.all([
        fetchEventsForType(startLedger, 'position_opened'),
        fetchEventsForType(startLedger, 'position_closed'),
        fetchEventsForType(startLedger, 'position_liquidated'),
      ]);

      // Combine all trades
      const allTrades = [...openedTrades, ...closedTrades, ...liquidatedTrades];

      // Sort by timestamp descending (newest first)
      allTrades.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      // Keep only the 20 most recent
      setTrades(allTrades.slice(0, 20));
      setLastUpdatedAt(new Date());
      setFetchFailed(false);
    } catch (error) {
      console.error('[RecentTrades] Fetch error:', error);
      // Keep last-good rows on screen; the header flips to a stale state.
      setFetchFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [fetchEventsForType]);

  // Initial fetch and polling
  useEffect(() => {
    // Initial fetch with slight delay
    const initialDelay = setTimeout(fetchRecentTrades, 500);

    // Poll every 30 seconds
    const interval = setInterval(fetchRecentTrades, 30000);

    return () => {
      clearTimeout(initialDelay);
      clearInterval(interval);
    };
  }, [fetchRecentTrades]);

  // Re-render every second so the relative times ("5s", "Updated 12s ago")
  // stay current between polls.
  useEffect(() => {
    const interval = setInterval(() => {
      setNowTick((t) => t + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Header liveness chip: "Updated Xs ago" tied to actual poll health (A14) —
  // never a permanent LIVE pulse.
  const liveness = (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          'inline-flex h-1.5 w-1.5 rounded-full',
          fetchFailed ? 'bg-amber-400' : lastUpdatedAt ? 'bg-emerald-500' : 'bg-neutral-600',
        )}
      />
      <span className={cn('text-[10px]', fetchFailed ? 'text-amber-400' : 'text-neutral-500')}>
        {fetchFailed
          ? 'Stale — retrying'
          : lastUpdatedAt
          ? `Updated ${formatCompactTime(lastUpdatedAt)} ago`
          : 'Loading…'}
      </span>
    </div>
  );

  if (isLoading && trades.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <h3 className="text-sm font-medium text-neutral-400">Recent Trades</h3>
          {liveness}
        </div>
        <RecentTradesSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h3 className="text-sm font-medium text-neutral-400">Recent Trades</h3>
        {liveness}
      </div>

      {/* Trade List */}
      <div className="flex-1 overflow-y-auto -mx-4 px-4 custom-scrollbar">
        {trades.length === 0 ? (
          fetchFailed ? (
            // Explicit, retryable error state — an RPC failure must not
            // masquerade as an empty market (A14).
            <div className="text-center py-8">
              <p className="text-xs text-neutral-400">Couldn&apos;t load recent trades</p>
              <button
                onClick={fetchRecentTrades}
                className="mt-2 text-xs text-[#eab308] underline hover:opacity-80"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-xs text-neutral-400">No trades yet</p>
              <p className="text-xs text-neutral-500 mt-1">
                Trades will appear here as users interact with the protocol.
              </p>
            </div>
          )
        ) : (
          <div className="space-y-0.5">
            {trades.map((trade) => {
              const rowContent = (
                <>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-medium text-white w-8 flex-shrink-0">
                      {trade.asset}
                    </span>
                    <span className={cn('text-xs font-medium w-10', sideColors[trade.side])}>
                      {trade.side}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-neutral-300 tabular-nums">
                      {formatUSD(trade.size, 0)}
                    </span>
                    <span className="text-xs text-neutral-500 w-6 text-right">
                      {formatCompactTime(trade.timestamp)}
                    </span>
                  </div>
                </>
              );
              const rowClass =
                'flex items-center justify-between py-1.5 px-2 -mx-2 rounded transition-colors hover:bg-white/5';
              // No href="#" affordances: rows without a tx hash are plain rows (A13).
              return trade.txHash ? (
                <a
                  key={trade.id}
                  href={`https://stellar.expert/explorer/${NETWORK.NAME}/tx/${trade.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={rowClass}
                >
                  {rowContent}
                </a>
              ) : (
                <div key={trade.id} className={rowClass}>
                  {rowContent}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
