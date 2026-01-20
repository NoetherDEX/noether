'use client';

import { useState, useEffect, useCallback } from 'react';
import { Clock, ExternalLink, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui';
import { formatUSD, formatDateTime, shortenTxHash } from '@/lib/utils';
import { cn } from '@/lib/utils/cn';
import { useWallet } from '@/lib/hooks/useWallet';
import { getTradeHistory } from '@/lib/stellar/market';
import type { Trade } from '@/types';

interface TradeHistoryProps {
  trades: Trade[];
  isLoading?: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
}

export function TradeHistory({ trades, isLoading, isRefreshing, onRefresh }: TradeHistoryProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-12 bg-white/5 rounded-lg animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
          <Clock className="w-8 h-8 text-neutral-600" />
        </div>
        <h3 className="text-lg font-medium text-neutral-300 mb-2">
          No Trade History
        </h3>
        <p className="text-sm text-neutral-500">
          Your completed trades will appear here
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Header with Refresh Button */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-neutral-500">
          {trades.length} trade{trades.length !== 1 ? 's' : ''}
        </span>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all',
              'text-neutral-400 hover:text-white hover:bg-white/5',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
            title="Refresh trades"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        )}
      </div>

      {/* Compact Table - Both Desktop and Mobile with horizontal scroll */}
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full min-w-[800px]">
          <thead>
            <tr className="text-xs text-neutral-500 border-b border-white/5">
              <th className="text-left py-3 px-3 font-medium whitespace-nowrap">ID</th>
              <th className="text-left py-3 px-3 font-medium whitespace-nowrap">Market</th>
              <th className="text-left py-3 px-3 font-medium whitespace-nowrap">Side</th>
              <th className="text-right py-3 px-3 font-medium whitespace-nowrap">Size</th>
              <th className="text-right py-3 px-3 font-medium whitespace-nowrap">Entry</th>
              <th className="text-right py-3 px-3 font-medium whitespace-nowrap">Exit</th>
              <th className="text-right py-3 px-3 font-medium whitespace-nowrap">Gross PnL</th>
              <th className="text-right py-3 px-3 font-medium whitespace-nowrap">Fees</th>
              <th className="text-right py-3 px-3 font-medium whitespace-nowrap">Net PnL</th>
              <th className="text-right py-3 px-3 font-medium whitespace-nowrap">Date</th>
              <th className="text-right py-3 px-3 font-medium whitespace-nowrap">Tx</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade, index) => (
              <TradeRow key={trade.id} trade={trade} index={trades.length - index} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Compact table row component
function TradeRow({
  trade,
  index,
}: {
  trade: Trade;
  index: number;
}) {
  const grossPnl = trade.pnl ?? 0;
  const fee = trade.fee ?? 0;
  const netPnl = grossPnl - Math.abs(fee);
  const isPositive = netPnl >= 0;
  const isLong = trade.direction === 'Long';

  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.02] transition-colors text-sm">
      {/* Trade ID */}
      <td className="py-3 px-3">
        <span className="text-neutral-400 font-mono text-xs">#{index}</span>
      </td>
      {/* Market */}
      <td className="py-3 px-3">
        <span className="font-medium text-white">{trade.asset || 'XLM'}/USD</span>
      </td>
      {/* Side */}
      <td className="py-3 px-3">
        <Badge variant={isLong ? 'success' : 'danger'} size="sm">
          {trade.direction || 'Long'}
        </Badge>
      </td>
      {/* Size */}
      <td className="py-3 px-3 text-right text-white">
        {formatUSD(trade.size ?? 0)}
      </td>
      {/* Entry Price */}
      <td className="py-3 px-3 text-right text-neutral-400">
        {formatUSD(trade.entryPrice ?? 0, trade.asset === 'XLM' ? 4 : 2)}
      </td>
      {/* Exit Price */}
      <td className="py-3 px-3 text-right text-neutral-400">
        {formatUSD(trade.price ?? 0, trade.asset === 'XLM' ? 4 : 2)}
      </td>
      {/* Gross PnL */}
      <td className="py-3 px-3 text-right">
        <span className={cn(
          'font-medium',
          grossPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
        )}>
          {grossPnl >= 0 ? '+' : ''}{formatUSD(grossPnl)}
        </span>
      </td>
      {/* Fees */}
      <td className="py-3 px-3 text-right">
        <span className="text-orange-400">
          -{formatUSD(Math.abs(fee))}
        </span>
      </td>
      {/* Net PnL */}
      <td className="py-3 px-3 text-right">
        <span className={cn(
          'font-semibold',
          isPositive ? 'text-emerald-400' : 'text-red-400'
        )}>
          {isPositive ? '+' : ''}{formatUSD(netPnl)}
        </span>
      </td>
      {/* Date */}
      <td className="py-3 px-3 text-right text-neutral-400 whitespace-nowrap">
        {formatDateTime(trade.timestamp)}
      </td>
      {/* Tx Hash with Explorer Link */}
      <td className="py-3 px-3 text-right">
        {trade.txHash ? (
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${trade.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-neutral-400 hover:text-white transition-colors font-mono text-xs"
            title={trade.txHash}
          >
            {shortenTxHash(trade.txHash)}
            <ExternalLink className="w-3 h-3" />
          </a>
        ) : (
          <span className="text-neutral-600">-</span>
        )}
      </td>
    </tr>
  );
}

// Container component that fetches and displays real trade history
export function TradeHistoryContainer() {
  const { isConnected, publicKey } = useWallet();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchTrades = useCallback(async (showLoading = true) => {
    if (!publicKey) return;

    if (showLoading) setIsLoading(true);
    setIsRefreshing(true);

    try {
      const tradeHistory = await getTradeHistory(publicKey);
      // Sort by timestamp descending - newest trades first
      tradeHistory.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      setTrades(tradeHistory);
    } catch (error) {
      console.error('Failed to fetch trade history:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [publicKey]);

  const handleRefresh = useCallback(() => {
    fetchTrades(false);
  }, [fetchTrades]);

  useEffect(() => {
    if (!isConnected || !publicKey) {
      setTrades([]);
      return;
    }

    fetchTrades(true);
  }, [isConnected, publicKey, fetchTrades]);

  return (
    <TradeHistory
      trades={trades}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      onRefresh={handleRefresh}
    />
  );
}
