'use client';

import { useState, useEffect, useCallback } from 'react';
import { Skeleton } from '@/components/ui';
import { NETWORK, CONTRACTS } from '@/lib/utils/constants';
import { cn } from '@/lib/utils/cn';
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
  const [, setLastUpdate] = useState<Date>(new Date());

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
          // Format: [position_id, trader, asset, size, direction]
          asset = String(data[2] || 'BTC').toUpperCase();
          size = bigIntToNumber(data[3] as bigint);
          side = parseDirection(data[4]);
        } else if (eventType === 'position_closed') {
          // Format: [position_id, trader, asset, direction, size, entry_price, exit_price, pnl, funding_paid]
          asset = String(data[2] || 'BTC').toUpperCase();
          size = bigIntToNumber(data[4] as bigint);
          side = 'Close';
        } else if (eventType === 'position_liquidated') {
          // Format: similar to position_closed
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
      console.error(`[RecentTrades] Failed to fetch ${eventType} events:`, error);
      return [];
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
      setLastUpdate(new Date());
    } catch (error) {
      console.error('[RecentTrades] Fetch error:', error);
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

  // Update relative times every second
  useEffect(() => {
    const interval = setInterval(() => {
      setLastUpdate(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  if (isLoading && trades.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <h3 className="text-sm font-medium text-neutral-400">Recent Trades</h3>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-xs text-neutral-500">LIVE</span>
          </div>
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
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-xs text-neutral-500">LIVE</span>
        </div>
      </div>

      {/* Trade List */}
      <div className="flex-1 overflow-y-auto -mx-4 px-4 custom-scrollbar">
        {trades.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-xs text-neutral-500">No trades yet</p>
            <p className="text-xs text-neutral-600 mt-1">
              Trades will appear here as users interact with the protocol.
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {trades.map((trade, index) => (
              <a
                key={trade.id}
                href={trade.txHash ? `https://stellar.expert/explorer/${NETWORK.NAME}/tx/${trade.txHash}` : '#'}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'flex items-center justify-between py-1.5 px-2 -mx-2 rounded transition-colors',
                  'hover:bg-white/5',
                  index === 0 && 'animate-pulse bg-white/5'
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-medium text-white w-8 flex-shrink-0">
                    {trade.asset}
                  </span>
                  <span className={cn('text-xs font-medium w-10', sideColors[trade.side])}>
                    {trade.side}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-neutral-300">
                    ${trade.size > 0 ? Math.round(trade.size).toLocaleString() : '0'}
                  </span>
                  <span className="text-xs text-neutral-500 w-6 text-right">
                    {formatCompactTime(trade.timestamp)}
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
