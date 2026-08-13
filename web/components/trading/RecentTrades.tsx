'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui';
import { NETWORK, CONTRACTS } from '@/lib/utils/constants';
import { cn } from '@/lib/utils/cn';
import { formatUSD } from '@/lib/utils';
import { listTrades, type TradeRow } from '@/lib/api/trades';
import { gatewayServesThisMarket } from '@/lib/api/gateway';
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
  Long: 'text-long',
  Short: 'text-short',
  Close: 'text-foreground',
  Liq: 'text-primary',
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

/**
 * Gateway /v1/trades row → GlobalTrade. Mirrors the legacy event parsing:
 * opens render as Long/Short entries, closes as Close, liquidations as Liq;
 * rows without a positive size are dropped — which also skips account-level
 * cross_liquidation rows (no size) exactly like the legacy size guard did.
 */
function rowToGlobalTrade(row: TradeRow): GlobalTrade | null {
  const size = row.size == null ? 0 : Number(row.size) / 1e7;
  if (size <= 0) return null;
  let asset = (row.asset ?? 'BTC').toUpperCase();
  if (asset.length > 5) asset = 'BTC';
  const side: GlobalTrade['side'] =
    row.kind === 'open'
      ? row.direction === 0
        ? 'Long'
        : 'Short'
      : row.kind === 'close'
        ? 'Close'
        : 'Liq';
  return {
    id: `${row.kind}-${row.positionId ?? 'x'}-${row.txHash}`,
    asset,
    side,
    size,
    timestamp: new Date(row.ts * 1000),
    txHash: row.txHash,
  };
}

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

  // Fetch all recent trades — gateway feed first (one HTTPS call, opens
  // included), legacy 3× getEvents scan when the gateway can't speak for
  // this market. Throws on total failure so the query flips to the stale
  // state (never a fake-empty "No trades yet").
  const fetchAllTrades = useCallback(async (): Promise<GlobalTrade[]> => {
    if (await gatewayServesThisMarket()) {
      try {
        const rows = await listTrades({ includeOpens: true, limit: 40 });
        return rows
          .map(rowToGlobalTrade)
          .filter((t): t is GlobalTrade => t !== null)
          .slice(0, 20);
      } catch {
        // gateway hiccup — legacy scan below
      }
    }

    const latestLedger = await sorobanRpc.getLatestLedger();
    // Use same lookback as Trade History (10000 ledgers = ~14 hours)
    const LOOKBACK_LEDGERS = 10000;
    const startLedger = Math.max(1, latestLedger.sequence - LOOKBACK_LEDGERS);
    const [openedTrades, closedTrades, liquidatedTrades] = await Promise.all([
      fetchEventsForType(startLedger, 'position_opened'),
      fetchEventsForType(startLedger, 'position_closed'),
      fetchEventsForType(startLedger, 'position_liquidated'),
    ]);
    const allTrades = [...openedTrades, ...closedTrades, ...liquidatedTrades];
    allTrades.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return allTrades.slice(0, 20);
  }, [fetchEventsForType]);

  // Global cache (providers.tsx): rows survive the Tabs unmount, so a
  // revisited tab paints instantly and revalidates in background. RQ keeps
  // the last-good data through failed refetches — same keep-last-good
  // semantics the manual state machine implemented (A14).
  const { data, isPending, isError, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['recentTrades'],
    queryFn: fetchAllTrades,
    refetchInterval: 30_000,
  });
  const trades = data ?? [];
  const isLoading = isPending;
  const fetchFailed = isError;
  const lastUpdatedAt = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

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
          fetchFailed ? 'bg-primary' : lastUpdatedAt ? 'bg-long' : 'bg-faint',
        )}
      />
      <span
        className={cn(
          'text-[10px] font-mono tabular-nums',
          fetchFailed ? 'text-primary' : 'text-faint',
        )}
      >
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
      <div className="flex flex-col">
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <h3 className="text-[13px] font-medium text-foreground">Recent Trades</h3>
          {liveness}
        </div>
        <RecentTradesSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h3 className="text-[13px] font-medium text-foreground">Recent Trades</h3>
        {liveness}
      </div>

      {/* Trade List */}
      <div className="max-h-[420px] overflow-y-auto custom-scrollbar">
        {trades.length === 0 ? (
          fetchFailed ? (
            // Explicit, retryable error state — an RPC failure must not
            // masquerade as an empty market (A14).
            <div className="text-center py-8">
              <p className="text-xs text-muted-foreground">Couldn&apos;t load recent trades</p>
              <button
                onClick={() => void refetch()}
                className="mt-2 text-xs text-primary underline hover:opacity-80 transition-opacity"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-xs text-muted-foreground">No trades yet</p>
              <p className="text-xs text-faint mt-1">
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
                    <span className="text-xs font-medium text-foreground w-8 flex-shrink-0">
                      {trade.asset}
                    </span>
                    <span className={cn('text-xs font-medium w-10', sideColors[trade.side])}>
                      {trade.side}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-foreground font-mono tabular-nums">
                      {formatUSD(trade.size, 0)}
                    </span>
                    <span className="text-xs text-faint font-mono tabular-nums w-6 text-right">
                      {formatCompactTime(trade.timestamp)}
                    </span>
                  </div>
                </>
              );
              // px without the old -mx bleed: the negative margin made every
              // row 16px wider than its container, which is exactly the
              // phantom horizontal scrollbar under the list.
              const rowClass =
                'flex items-center justify-between py-2 px-2 rounded-sm transition-colors hover:bg-surface-3/50';
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
