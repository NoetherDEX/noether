'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ExternalLink, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { formatUSD } from '@/lib/utils';
import { getAllPendingOrders, toDisplayOrder } from '@/lib/stellar/market';
import { getPrice, priceToDisplay } from '@/lib/stellar/oracle';
import { useWallet } from '@/lib/hooks/useWallet';
import type { DisplayOrder } from '@/types';

interface OrderBookProps {
  asset: string;
}

interface OrderBookEntry extends DisplayOrder {
  stellarExpertUrl: string;
}

export function OrderBook({ asset }: OrderBookProps) {
  const { publicKey } = useWallet();
  const [orders, setOrders] = useState<OrderBookEntry[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch orders
  const fetchOrders = useCallback(async (showLoading = true) => {
    // Use a default public key for read-only queries if not connected
    const queryKey = publicKey || 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

    if (showLoading) setIsLoading(true);
    setIsRefreshing(true);

    try {
      // Fetch all pending orders
      const allOrders = await getAllPendingOrders(queryKey);

      // Filter for current asset and only limit entry orders
      const assetOrders = allOrders
        .filter(order => order.asset === asset && order.orderType === 'LimitEntry')
        .map(order => {
          const displayOrder = toDisplayOrder(order);
          return {
            ...displayOrder,
            stellarExpertUrl: `https://stellar.expert/explorer/testnet/account/${order.trader}`,
          };
        });

      setOrders(assetOrders);

      // Fetch current price
      if (queryKey !== 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF') {
        const priceData = await getPrice(queryKey, asset);
        if (priceData) {
          setCurrentPrice(priceToDisplay(priceData.price));
        }
      }
    } catch (error) {
      console.error('Failed to fetch orderbook:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [publicKey, asset]);

  // Initial fetch and polling
  useEffect(() => {
    fetchOrders(true);
    const interval = setInterval(() => fetchOrders(false), 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, [fetchOrders]);

  // Separate long and short orders
  const longOrders = orders
    .filter(o => o.direction === 'Long')
    .sort((a, b) => b.triggerPrice - a.triggerPrice); // Highest first

  const shortOrders = orders
    .filter(o => o.direction === 'Short')
    .sort((a, b) => a.triggerPrice - b.triggerPrice); // Lowest first

  // Truncate address for display
  const truncateAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  // Format price based on asset
  const formatPrice = (price: number) => {
    if (asset === 'XLM') return `$${price.toFixed(4)}`;
    return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  if (isLoading) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-foreground">Order Book</h3>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground text-sm">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">Order Book</h3>
        <button
          onClick={() => fetchOrders(false)}
          disabled={isRefreshing}
          className={cn(
            'p-1.5 rounded hover:bg-zinc-900/50 text-muted-foreground hover:text-foreground transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
          title="Refresh orderbook"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
        </button>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-[2fr_1.2fr_1fr] gap-2 text-[10px] text-muted-foreground mb-2 px-1">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Trader</span>
      </div>

      {/* Scrollable Order List */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-1">
        {/* Short Orders (Sells) - Above current price */}
        {shortOrders.length > 0 && (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1 px-1 py-1">
              <TrendingDown className="w-3 h-3 text-[#ef4444]" />
              <span className="text-[10px] font-medium text-[#ef4444] uppercase">Short Orders</span>
            </div>
            {shortOrders.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                formatPrice={formatPrice}
                truncateAddress={truncateAddress}
                variant="short"
              />
            ))}
          </div>
        )}

        {/* Current Price Separator */}
        {currentPrice > 0 && (
          <div className="flex items-center gap-2 py-2 px-1">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <span className="text-xs font-mono font-bold text-foreground">
              {formatPrice(currentPrice)}
            </span>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          </div>
        )}

        {/* Long Orders (Buys) - Below current price */}
        {longOrders.length > 0 && (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1 px-1 py-1">
              <TrendingUp className="w-3 h-3 text-[#22c55e]" />
              <span className="text-[10px] font-medium text-[#22c55e] uppercase">Long Orders</span>
            </div>
            {longOrders.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                formatPrice={formatPrice}
                truncateAddress={truncateAddress}
                variant="long"
              />
            ))}
          </div>
        )}

        {/* Empty State */}
        {orders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-10 h-10 rounded-full bg-zinc-900/50 flex items-center justify-center mb-3">
              <TrendingUp className="w-5 h-5 text-muted-foreground/50" />
            </div>
            <p className="text-xs text-muted-foreground">No pending limit orders</p>
            <p className="text-[10px] text-muted-foreground/70 mt-1">
              Place a limit order to see it here
            </p>
          </div>
        )}
      </div>

      {/* Footer Stats */}
      <div className="pt-2 mt-2 border-t border-white/5">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{longOrders.length} Long</span>
          <span>{shortOrders.length} Short</span>
          <span>{orders.length} Total</span>
        </div>
      </div>
    </div>
  );
}

// Individual order row component
function OrderRow({
  order,
  formatPrice,
  truncateAddress,
  variant,
}: {
  order: OrderBookEntry;
  formatPrice: (price: number) => string;
  truncateAddress: (address: string) => string;
  variant: 'long' | 'short';
}) {
  const bgColor = variant === 'long' ? 'bg-[#22c55e]/5' : 'bg-[#ef4444]/5';
  const textColor = variant === 'long' ? 'text-[#22c55e]' : 'text-[#ef4444]';

  return (
    <div
      className={cn(
        'grid grid-cols-[2fr_1.2fr_1fr] gap-2 px-1 py-1.5 rounded text-[11px] font-mono hover:bg-zinc-900/50 transition-colors',
        bgColor
      )}
    >
      {/* Price */}
      <span className={cn(textColor, 'truncate')}>
        {formatPrice(order.triggerPrice)}
      </span>

      {/* Size */}
      <span className="text-right text-foreground truncate">
        ${order.positionSize.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </span>

      {/* Trader Address (clickable) */}
      <a
        href={order.stellarExpertUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-right text-muted-foreground hover:text-primary flex items-center justify-end gap-0.5 group truncate"
        title={order.trader}
      >
        <span className="truncate">{truncateAddress(order.trader)}</span>
        <ExternalLink className="w-2.5 h-2.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </a>
    </div>
  );
}
