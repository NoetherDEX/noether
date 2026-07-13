'use client';

import { useState, useEffect, useCallback } from 'react';
import { Clock, ExternalLink, Info, RefreshCw, Share2 } from 'lucide-react';
import { Badge, Tooltip } from '@/components/ui';
import { formatUSD, formatDateTime, shortenTxHash, priceDecimals } from '@/lib/utils';
import { cn } from '@/lib/utils/cn';
import { STELLAR_EXPERT_BASE } from '@/lib/utils/constants';
import { useWallet } from '@/lib/hooks/useWallet';
import { getTradeHistory } from '@/lib/stellar/market';
import { PnlShareModal } from '@/components/share/PnlShareModal';
import type { Trade, PnlShareData } from '@/types';

interface TradeHistoryProps {
  trades: Trade[];
  isLoading?: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
}

export function TradeHistory({ trades, isLoading, isRefreshing, onRefresh }: TradeHistoryProps) {
  const [shareData, setShareData] = useState<PnlShareData | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);

  const handleShare = (trade: Trade) => {
    // The deployed event carries no fee, so the shared figure is the GROSS
    // PnL (fee ?? 0 only feeds arithmetic here — no fee value is displayed).
    const grossPnl = trade.pnl ?? 0;
    const fee = trade.fee ?? 0;
    const netPnl = grossPnl - Math.abs(fee);
    const netPnlPercent = trade.size ? (netPnl / trade.size) * 100 : 0;

    setShareData({
      asset: trade.asset || 'XLM',
      direction: trade.direction || 'Long',
      entryPrice: trade.entryPrice ?? 0,
      exitPrice: trade.price ?? 0,
      pnl: netPnl,
      pnlPercent: netPnlPercent,
      date: trade.timestamp,
      isOpen: false,
    });
    setShowShareModal(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-12 bg-surface-3 rounded-md animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-2 flex items-center justify-center">
          <Clock className="w-8 h-8 text-faint" />
        </div>
        <h3 className="font-medium text-foreground mb-2">
          No Trade History
        </h3>
        <p className="text-sm text-muted-foreground">
          Your completed trades will appear here
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Header with Refresh Button */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">
          {trades.length} trade{trades.length !== 1 ? 's' : ''}
        </span>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors',
              'text-muted-foreground hover:text-foreground hover:bg-surface-3',
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
            <tr className="border-b border-border">
              <th className="text-left py-2 px-3 text-[11px] font-medium uppercase tracking-wide text-faint whitespace-nowrap">ID</th>
              <th className="text-left py-2 px-3 text-[11px] font-medium uppercase tracking-wide text-faint whitespace-nowrap">Market</th>
              <th className="text-left py-2 px-3 text-[11px] font-medium uppercase tracking-wide text-faint whitespace-nowrap">Side</th>
              <th className="text-right py-2 px-3 text-[11px] font-medium uppercase tracking-wide text-faint whitespace-nowrap">Size</th>
              <th className="text-right py-2 px-3 text-[11px] font-medium uppercase tracking-wide text-faint whitespace-nowrap">Entry</th>
              <th className="text-right py-2 px-3 text-[11px] font-medium uppercase tracking-wide text-faint whitespace-nowrap">Exit</th>
              <th className="text-right py-2 px-3 text-[11px] font-medium uppercase tracking-wide text-faint whitespace-nowrap">Gross PnL</th>
              <th className="text-right py-2 px-3 text-[11px] font-medium uppercase tracking-wide text-faint whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                  Fees
                  <Tooltip content="Fee breakdown ships with the next contract deploy — the current on-chain event doesn't report it." position="bottom">
                    <Info className="w-3 h-3 opacity-50" />
                  </Tooltip>
                </span>
              </th>
              <th className="text-right py-2 px-3 text-[11px] font-medium uppercase tracking-wide text-faint whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                  Net PnL
                  <Tooltip content="Net PnL needs the fee, which the current on-chain event doesn't report — coming with the next contract deploy." position="bottom">
                    <Info className="w-3 h-3 opacity-50" />
                  </Tooltip>
                </span>
              </th>
              <th className="text-right py-2 px-3 text-[11px] font-medium uppercase tracking-wide text-faint whitespace-nowrap">Date</th>
              <th className="text-right py-2 px-3 text-[11px] font-medium uppercase tracking-wide text-faint whitespace-nowrap">Tx</th>
              <th className="text-center py-2 px-3 text-[11px] font-medium uppercase tracking-wide text-faint whitespace-nowrap"></th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade, index) => (
              <TradeRow
                key={trade.id}
                trade={trade}
                index={trades.length - index}
                onShare={
                  // Liq events lack entry/PnL until C2 — sharing them would
                  // render fabricated zeros on the card.
                  trade.type === 'close' ||
                  (trade.type === 'liquidation' && trade.pnl != null && trade.entryPrice != null)
                    ? () => handleShare(trade)
                    : undefined
                }
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Share PnL Modal */}
      <PnlShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        data={shareData}
      />
    </>
  );
}

// Compact table row component
function TradeRow({
  trade,
  index,
  onShare,
}: {
  trade: Trade;
  index: number;
  onShare?: () => void;
}) {
  // pnl == null → UNKNOWN (the deployed position_liquidated event carries no
  // PnL until C2): render '—', never a fabricated +$0.00 (B1/A15).
  const grossPnl = trade.pnl != null && Number.isFinite(trade.pnl) ? trade.pnl : null;
  // fee == null → UNKNOWN (the deployed event doesn't emit it): Fees and
  // Net PnL render '—' — never assert the venue charged $0.00 (A15).
  const fee = trade.fee != null && Number.isFinite(trade.fee) ? trade.fee : null;
  const netPnl = fee != null && grossPnl != null ? grossPnl - Math.abs(fee) : null;
  const isPositive = (netPnl ?? grossPnl ?? 0) >= 0;
  const isLong = trade.direction === 'Long';
  const isLiquidation = trade.type === 'liquidation';
  // cross_liq is one account-level event — no single asset/side/size.
  const isCrossLiq = isLiquidation && trade.asset === 'CROSS';

  return (
    <tr className="border-b border-border hover:bg-surface-3/50 transition-colors text-xs">
      {/* Trade ID */}
      <td className="py-2 px-3">
        <span className="text-faint font-mono text-xs">#{index}</span>
      </td>
      {/* Market */}
      <td className="py-2 px-3">
        <span className="font-medium text-foreground">
          {isCrossLiq ? 'Cross account' : `${trade.asset || 'XLM'}/USD`}
        </span>
      </td>
      {/* Side (+ explicit Liquidated marker — B1) */}
      <td className="py-2 px-3">
        <span className="inline-flex items-center gap-1.5">
          {!isCrossLiq && (
            <Badge variant={isLong ? 'success' : 'danger'} size="sm">
              {trade.direction || 'Long'}
            </Badge>
          )}
          {isLiquidation && (
            <Badge variant="danger" size="sm">
              Liq
            </Badge>
          )}
        </span>
      </td>
      {/* Size */}
      <td className="py-2 px-3 text-right text-foreground font-mono">
        {isCrossLiq ? <span className="text-faint">—</span> : formatUSD(trade.size ?? 0)}
      </td>
      {/* Entry Price — unknown for liquidation events until C2 */}
      <td className="py-2 px-3 text-right text-muted-foreground font-mono">
        {trade.entryPrice != null ? (
          formatUSD(trade.entryPrice, priceDecimals(trade.asset))
        ) : (
          <span className="text-faint">—</span>
        )}
      </td>
      {/* Exit / liquidation price */}
      <td className="py-2 px-3 text-right text-muted-foreground font-mono">
        {isCrossLiq ? (
          <span className="text-faint">—</span>
        ) : (
          formatUSD(trade.price ?? 0, priceDecimals(trade.asset))
        )}
      </td>
      {/* Gross PnL — '—' when the event doesn't report it */}
      <td className="py-2 px-3 text-right">
        {grossPnl != null ? (
          <span className={cn(
            'font-medium font-mono',
            grossPnl >= 0 ? 'text-long' : 'text-short'
          )}>
            {grossPnl >= 0 ? '+' : ''}{formatUSD(grossPnl)}
          </span>
        ) : (
          <span className="text-faint">—</span>
        )}
      </td>
      {/* Fees — unknown until the contract emits it */}
      <td className="py-2 px-3 text-right">
        {fee != null ? (
          <span className="text-muted-foreground font-mono">
            -{formatUSD(Math.abs(fee))}
          </span>
        ) : (
          <span className="text-faint">—</span>
        )}
      </td>
      {/* Net PnL — needs the fee */}
      <td className="py-2 px-3 text-right">
        {netPnl != null ? (
          <span className={cn(
            'font-medium font-mono',
            isPositive ? 'text-long' : 'text-short'
          )}>
            {isPositive ? '+' : ''}{formatUSD(netPnl)}
          </span>
        ) : (
          <span className="text-faint">—</span>
        )}
      </td>
      {/* Date */}
      <td className="py-2 px-3 text-right text-faint font-mono whitespace-nowrap">
        {formatDateTime(trade.timestamp)}
      </td>
      {/* Tx Hash with Explorer Link */}
      <td className="py-2 px-3 text-right">
        {trade.txHash ? (
          <a
            href={`${STELLAR_EXPERT_BASE}/tx/${trade.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors font-mono text-xs"
            title={trade.txHash}
          >
            {shortenTxHash(trade.txHash)}
            <ExternalLink className="w-3 h-3" />
          </a>
        ) : (
          <span className="text-faint">-</span>
        )}
      </td>
      {/* Share */}
      <td className="py-2 px-3 text-center">
        {onShare && (
          <button
            onClick={onShare}
            className="p-1.5 rounded-sm hover:bg-surface-3 text-muted-foreground hover:text-foreground transition-colors"
            title="Share PnL"
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>
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
