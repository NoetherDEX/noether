'use client';

import { useState, useEffect } from 'react';
import { Clock, ExternalLink, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Badge } from '@/components/ui';
import { formatUSD, formatRelativeTime } from '@/lib/utils';
import { cn } from '@/lib/utils/cn';
import type { Trade } from '@/types';

interface TradeHistoryProps {
  trades: Trade[];
  isLoading?: boolean;
}

export function TradeHistory({ trades, isLoading }: TradeHistoryProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-14 bg-white/5 rounded-lg animate-pulse"
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
    <div className="space-y-2">
      {/* Header */}
      <div className="hidden md:grid grid-cols-7 gap-4 px-4 py-2 text-xs text-neutral-500 font-medium">
        <div>Type</div>
        <div>Asset</div>
        <div className="text-right">Size</div>
        <div className="text-right">Price</div>
        <div className="text-right">PnL</div>
        <div className="text-right">Fee</div>
        <div className="text-right">Time</div>
      </div>

      {/* Trades */}
      {trades.map((trade) => (
        <TradeRow key={trade.id} trade={trade} />
      ))}
    </div>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const getTypeBadge = () => {
    switch (trade.type) {
      case 'open':
        return (
          <Badge variant={trade.direction === 'Long' ? 'success' : 'danger'}>
            {trade.direction === 'Long' ? (
              <ArrowUpRight className="w-3 h-3 mr-1" />
            ) : (
              <ArrowDownRight className="w-3 h-3 mr-1" />
            )}
            Open {trade.direction}
          </Badge>
        );
      case 'close':
        return <Badge variant="default">Close</Badge>;
      case 'liquidation':
        return <Badge variant="warning">Liquidated</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-7 gap-4 px-4 py-3 bg-white/[0.02] rounded-lg hover:bg-white/[0.04] transition-colors">
      {/* Type */}
      <div className="flex items-center">
        {getTypeBadge()}
      </div>

      {/* Asset */}
      <div className="flex items-center">
        <span className="text-white font-medium">{trade.asset}/USD</span>
      </div>

      {/* Size */}
      <div className="text-right">
        <span className="text-white">{formatUSD(trade.size)}</span>
      </div>

      {/* Price */}
      <div className="text-right">
        <span className="text-neutral-300">
          {formatUSD(trade.price, trade.asset === 'XLM' ? 4 : 2)}
        </span>
      </div>

      {/* PnL */}
      <div className="text-right">
        {trade.pnl !== undefined ? (
          <span
            className={cn(
              'font-medium',
              trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
            )}
          >
            {trade.pnl >= 0 ? '+' : ''}{formatUSD(trade.pnl)}
          </span>
        ) : (
          <span className="text-neutral-500">-</span>
        )}
      </div>

      {/* Fee */}
      <div className="text-right">
        <span className="text-neutral-400">{formatUSD(trade.fee)}</span>
      </div>

      {/* Time */}
      <div className="flex items-center justify-end gap-2">
        <span className="text-neutral-500 text-sm">
          {formatRelativeTime(trade.timestamp.getTime())}
        </span>
        <a
          href={`https://stellar.expert/explorer/testnet/tx/${trade.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-neutral-500 hover:text-white transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}

// Helper component to fetch and display real trade history
export function TradeHistoryContainer() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // TODO: Fetch from Soroban events
    // For now, show empty state
    setIsLoading(false);
  }, []);

  return <TradeHistory trades={trades} isLoading={isLoading} />;
}
