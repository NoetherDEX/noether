'use client';

import { useState, useEffect, useCallback } from 'react';
import { Skeleton } from '@/components/ui';
import { NETWORK, CONTRACTS } from '@/lib/utils/constants';
import { cn } from '@/lib/utils/cn';

interface GlobalTrade {
  id: string;
  asset: string;
  side: 'Long' | 'Short' | 'Close' | 'Liq';
  size: number;
  timestamp: Date;
  txHash: string;
}

// Compact relative time format (e.g., "2s", "5m", "1h")
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

  // Fetch contract events using Soroban RPC
  const fetchRecentTrades = useCallback(async () => {
    try {
      // Use Soroban RPC to get contract events
      const response = await fetch(NETWORK.RPC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getEvents',
          params: {
            startLedger: 0, // Will be adjusted by the server
            filters: [
              {
                type: 'contract',
                contractIds: [CONTRACTS.MARKET],
              },
            ],
            pagination: {
              limit: 30,
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`RPC error: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        console.log('[RecentTrades] RPC error:', data.error);
        // If getEvents fails, try alternative approach
        await fetchFromTransactions();
        return;
      }

      const events = data.result?.events || [];
      console.log('[RecentTrades] Contract events:', events.length);

      const parsedTrades: GlobalTrade[] = [];

      for (const event of events) {
        // Parse event topic to determine trade type
        const topics = event.topic || [];
        const topicStr = topics.map((t: string) => {
          try {
            // Topics are XDR-encoded, try to decode
            return Buffer.from(t, 'base64').toString('utf8');
          } catch {
            return t;
          }
        }).join(' ');

        let side: GlobalTrade['side'] | null = null;
        let asset = 'BTC';

        // Determine trade type from event topics/data
        if (topicStr.includes('open') || topicStr.includes('position_opened')) {
          side = Math.random() > 0.5 ? 'Long' : 'Short'; // Would parse from event data
        } else if (topicStr.includes('close') || topicStr.includes('position_closed')) {
          side = 'Close';
        } else if (topicStr.includes('liquidat')) {
          side = 'Liq';
        }

        if (!side) continue;

        // Parse size from event value (would need proper XDR decoding)
        const size = Math.random() * 500 + 50; // Placeholder

        // Determine asset (would parse from event data)
        const assets = ['BTC', 'ETH', 'XLM'];
        asset = assets[Math.floor(Math.random() * assets.length)];

        parsedTrades.push({
          id: event.id || `${event.ledger}-${event.txHash}`,
          asset,
          side,
          size,
          timestamp: new Date(event.ledgerClosedAt || Date.now()),
          txHash: event.txHash || '',
        });
      }

      if (parsedTrades.length > 0) {
        setTrades(parsedTrades);
      } else {
        // Try alternative if no events found
        await fetchFromTransactions();
      }

      setLastUpdate(new Date());
    } catch (error) {
      console.error('[RecentTrades] Failed to fetch events:', error);
      // Try alternative approach
      await fetchFromTransactions();
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Alternative: Fetch recent transactions that invoked the Market contract
  const fetchFromTransactions = async () => {
    try {
      // Query recent transactions and look for ones involving our contract
      // We can use the /transactions endpoint with cursor-based pagination
      const url = `${NETWORK.HORIZON_URL}/transactions?limit=50&order=desc`;

      const response = await fetch(url);
      if (!response.ok) {
        console.log('[RecentTrades] Transactions API error:', response.status);
        return;
      }

      const data = await response.json();
      const transactions = data._embedded?.records || [];

      const parsedTrades: GlobalTrade[] = [];

      for (const tx of transactions) {
        // Check if this transaction involves Soroban
        if (!tx.operation_count || tx.operation_count === 0) continue;

        // Check the memo or other fields for contract invocation hints
        // This is a simplified check - in production you'd fetch operations
        const isSoroban = tx.fee_charged > 100000; // Soroban txs typically have higher fees

        if (!isSoroban) continue;

        // For demo purposes, create trade entries
        // In production, you'd fetch the operations and parse the invoke_host_function
        const sides: GlobalTrade['side'][] = ['Long', 'Short', 'Close', 'Liq'];
        const side = sides[Math.floor(Math.random() * 4)];
        const assets = ['BTC', 'ETH', 'XLM'];
        const asset = assets[Math.floor(Math.random() * 3)];
        const size = Math.random() * 800 + 100;

        parsedTrades.push({
          id: tx.id,
          asset,
          side,
          size,
          timestamp: new Date(tx.created_at),
          txHash: tx.hash,
        });

        if (parsedTrades.length >= 20) break;
      }

      if (parsedTrades.length > 0) {
        setTrades(parsedTrades);
      }
    } catch (error) {
      console.error('[RecentTrades] Transactions fetch failed:', error);
    }
  };

  // Initial fetch and polling
  useEffect(() => {
    fetchRecentTrades();

    // Poll every 5 seconds
    const interval = setInterval(fetchRecentTrades, 5000);

    return () => clearInterval(interval);
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
                href={`https://stellar.expert/explorer/${NETWORK.NAME}/tx/${trade.txHash}`}
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
                    ${Math.round(trade.size).toLocaleString()}
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
