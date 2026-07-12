'use client';

import { useState } from 'react';
import { Clock, X, RefreshCw, Shield, Target, ArrowDownCircle } from 'lucide-react';
import { Button, Badge, Modal, Card } from '@/components/ui';
import { formatUSD, formatRelativeTime, priceDecimals } from '@/lib/utils';
import { cn } from '@/lib/utils/cn';
import type { DisplayOrder } from '@/types';

interface OrdersListProps {
  orders: DisplayOrder[];
  isLoading?: boolean;
  isRefreshing?: boolean;
  onCancelOrder?: (id: number) => Promise<void>;
  onRefresh?: () => void;
  currentPrices?: Record<string, number>;
}

export function OrdersList({
  orders,
  isLoading,
  isRefreshing,
  onCancelOrder,
  onRefresh,
  currentPrices = {},
}: OrdersListProps) {
  const [selectedOrder, setSelectedOrder] = useState<DisplayOrder | null>(null);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // Split into pending and history
  const pendingOrders = orders.filter((o) => o.status === 'Pending');
  const historyOrders = orders
    .filter((o) => o.status !== 'Pending')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 20);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <div
            key={i}
            className="h-14 bg-surface-3 rounded-md animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (pendingOrders.length === 0 && historyOrders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="relative mb-4">
          <div className="w-14 h-14 rounded-full bg-surface-2 flex items-center justify-center">
            <Clock className="w-7 h-7 text-faint" />
          </div>
        </div>
        <h3 className="text-foreground font-medium mb-1">No orders</h3>
        <p className="text-muted-foreground text-sm text-center max-w-xs">
          Place a limit order or set stop-loss/take-profit on your positions.
        </p>
      </div>
    );
  }

  const handleCancel = async () => {
    if (!selectedOrder || !onCancelOrder || isCancelling) return;

    setIsCancelling(true);
    try {
      await onCancelOrder(selectedOrder.id);
      setIsCancelModalOpen(false);
      setSelectedOrder(null);
    } catch (error) {
      console.error('Failed to cancel order:', error);
    } finally {
      setIsCancelling(false);
    }
  };

  const getOrderTypeIcon = (orderType: string) => {
    switch (orderType) {
      case 'LimitEntry':
        return <ArrowDownCircle className="w-4 h-4" />;
      case 'StopLoss':
        return <Shield className="w-4 h-4" />;
      case 'TakeProfit':
        return <Target className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const getOrderTypeLabel = (orderType: string, stopLimitPhase?: number) => {
    switch (orderType) {
      case 'LimitEntry':
        return 'Limit';
      case 'StopLoss':
        return 'SL';
      case 'TakeProfit':
        return 'TP';
      case 'StopLimit':
        return stopLimitPhase === 1 ? 'StopLimit ⚡' : 'StopLimit';
      case 'TrailingStop':
        return 'TrailingStop';
      default:
        return orderType;
    }
  };

  const getOrderTypeColor = (orderType: string) => {
    switch (orderType) {
      case 'StopLoss':
        return 'text-short bg-short/10';
      case 'TakeProfit':
        return 'text-long bg-long/10';
      case 'TrailingStop':
        return 'text-primary bg-primary/10';
      case 'StopLimit':
        return 'text-primary bg-primary/10';
      default:
        return 'text-muted-foreground bg-surface-2';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Executed':
        return <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-medium bg-long/10 text-long">Filled</span>;
      case 'Cancelled':
        return <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-medium bg-surface-2 text-muted-foreground">Cancelled</span>;
      case 'CancelledSlippage':
        return <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-medium bg-primary/10 text-primary">Slippage</span>;
      case 'Expired':
        return <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-medium bg-surface-2 text-faint">Expired</span>;
      default:
        return null;
    }
  };

  const getTifBadge = (tif: string) => {
    switch (tif) {
      case 'IOC':
        return <span className="px-1 py-0.5 rounded-sm text-[9px] font-medium bg-primary/10 text-primary">IOC</span>;
      case 'PostOnly':
        return <span className="px-1 py-0.5 rounded-sm text-[9px] font-medium bg-surface-2 text-muted-foreground">Post Only</span>;
      default:
        return null; // GTC is default, no badge needed
    }
  };

  const getDistanceToTrigger = (order: DisplayOrder) => {
    if (order.orderType === 'TrailingStop') return null;
    const currentPrice = currentPrices[order.asset];
    if (!currentPrice || order.triggerPrice === 0) return null;
    const distance = ((order.triggerPrice - currentPrice) / currentPrice) * 100;
    const absDistance = Math.abs(distance);
    return `${absDistance.toFixed(1)}% away`;
  };

  const renderOrderRow = (order: DisplayOrder, showActions: boolean) => (
    <tr
      key={order.id}
      className={cn(
        'border-b border-border transition-colors',
        showActions ? 'hover:bg-surface-3/50' : 'opacity-60'
      )}
    >
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div className={cn('inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm text-[11px] font-medium', getOrderTypeColor(order.orderType))}>
            {getOrderTypeIcon(order.orderType)}
            {getOrderTypeLabel(order.orderType, order.stopLimitPhase)}
          </div>
          {getTifBadge(order.timeInForce)}
          {order.reduceOnly && (
            <span className="px-1 py-0.5 rounded-sm text-[9px] font-medium bg-primary/10 text-primary">RO</span>
          )}
        </div>
      </td>

      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{order.asset}-PERP</span>
          <span
            className={cn(
              'px-1.5 py-0.5 rounded-sm text-[11px] font-medium font-mono',
              order.direction === 'Long'
                ? 'bg-long/10 text-long'
                : 'bg-short/10 text-short'
            )}
          >
            {order.leverage}x
          </span>
        </div>
        <span
          className={cn(
            'text-[10px] font-medium',
            order.direction === 'Long' ? 'text-long' : 'text-short'
          )}
        >
          {order.direction.toUpperCase()}
        </span>
      </td>

      <td className="px-3 py-2 text-right">
        {order.orderType === 'TrailingStop' ? (
          <>
            <div className="font-mono text-foreground">Trailing</div>
            <div className="font-mono text-primary text-[10px]">
              {(order.trailingPercentBps / 100).toFixed(1)}% trail
            </div>
          </>
        ) : order.orderType === 'StopLoss' || order.orderType === 'TakeProfit' ? (
          <>
            <div className="font-mono text-foreground">Position</div>
            <div className="font-mono text-muted-foreground text-[10px]">
              #{order.positionId}
            </div>
          </>
        ) : (
          <>
            <div className="font-mono text-foreground">
              ${order.positionSize.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <div className="font-mono text-muted-foreground text-[10px]">
              {order.collateral.toFixed(2)} USDC
            </div>
          </>
        )}
      </td>

      <td className="px-3 py-2 text-right">
        {order.orderType === 'TrailingStop' ? (
          <>
            <div className="font-mono text-primary">Dynamic</div>
            <div className="text-[10px] text-muted-foreground">
              Tracks peak
            </div>
          </>
        ) : order.orderType === 'StopLimit' && order.stopLimitPhase === 1 ? (
          <>
            <div className="font-mono text-foreground">
              {formatUSD(order.limitPrice, priceDecimals(order.asset))}
            </div>
            <div className="text-[10px] text-primary">
              Limit active
            </div>
          </>
        ) : order.orderType === 'StopLimit' ? (
          <>
            <div className="font-mono text-foreground">
              {formatUSD(order.triggerPrice, priceDecimals(order.asset))}
            </div>
            <div className="text-[10px] text-muted-foreground">
              Stop → {formatUSD(order.limitPrice, priceDecimals(order.asset))}
            </div>
          </>
        ) : (
          <>
            <div className="font-mono text-foreground">
              {formatUSD(order.triggerPrice, priceDecimals(order.asset))}
            </div>
            {showActions ? (
              <div className="text-[10px] text-muted-foreground">
                {getDistanceToTrigger(order) || order.triggerCondition}
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground">
                {order.triggerCondition}
              </div>
            )}
          </>
        )}
      </td>

      <td className="px-3 py-2 text-right">
        <span className="text-faint text-[10px] font-mono">
          {formatRelativeTime(order.createdAt)}
        </span>
      </td>

      <td className="px-3 py-2">
        <div className="flex items-center justify-center">
          {showActions ? (
            <button
              onClick={() => {
                setSelectedOrder(order);
                setIsCancelModalOpen(true);
              }}
              className="h-7 px-2 rounded-sm text-[11px] font-medium border border-border-strong text-muted-foreground hover:text-short hover:border-short/40 hover:bg-surface-3 transition-colors flex items-center gap-1"
              title="Cancel Order"
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
          ) : (
            getStatusBadge(order.status)
          )}
        </div>
      </td>
    </tr>
  );

  return (
    <>
      {/* Header with Refresh Button */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">
          {pendingOrders.length} pending{historyOrders.length > 0 ? ` · ${historyOrders.length} recent` : ''}
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
            title="Refresh orders"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        )}
      </div>

      {/* Desktop Table */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface z-10">
            <tr className="border-b border-border">
              <th className="text-left px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-faint">Type</th>
              <th className="text-left px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-faint">Market</th>
              <th className="text-right px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-faint">Size</th>
              <th className="text-right px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-faint">Trigger Price</th>
              <th className="text-right px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-faint">Time</th>
              <th className="text-center px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-faint">Status</th>
            </tr>
          </thead>
          <tbody>
            {pendingOrders.map((order) => renderOrderRow(order, true))}
            {historyOrders.length > 0 && pendingOrders.length > 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-2">
                  <div className="border-t border-border" />
                </td>
              </tr>
            )}
            {historyOrders.map((order) => renderOrderRow(order, false))}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="lg:hidden space-y-3">
        {pendingOrders.map((order) => (
          <Card key={order.id} padding="md">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <div className={cn('inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm text-[11px] font-medium', getOrderTypeColor(order.orderType))}>
                    {getOrderTypeIcon(order.orderType)}
                    {getOrderTypeLabel(order.orderType)}
                  </div>
                  <span className="font-semibold text-foreground">{order.asset}</span>
                  <Badge variant={order.direction === 'Long' ? 'success' : 'danger'} size="sm">
                    {order.direction} {order.leverage}x
                  </Badge>
                  {getTifBadge(order.timeInForce)}
                  {order.reduceOnly && (
                    <span className="px-1 py-0.5 rounded-sm text-[9px] font-medium bg-primary/10 text-primary">RO</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatRelativeTime(order.createdAt)}
                  {getDistanceToTrigger(order) && (
                    <span className="ml-2 text-muted-foreground">· {getDistanceToTrigger(order)}</span>
                  )}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              <div>
                <p className="text-muted-foreground mb-1 text-xs">
                  {order.orderType === 'TrailingStop' ? 'Trail' : 'Size'}
                </p>
                <p className="text-foreground font-mono">
                  {order.orderType === 'TrailingStop'
                    ? `${(order.trailingPercentBps / 100).toFixed(1)}%`
                    : order.hasPosition
                    ? `Position #${order.positionId}`
                    : formatUSD(order.positionSize)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 text-xs">Trigger</p>
                <p className="text-foreground font-mono">
                  {order.orderType === 'TrailingStop'
                    ? 'Dynamic'
                    : formatUSD(order.triggerPrice, 2)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 text-xs">
                  {order.orderType === 'StopLimit' ? 'Limit Price' : 'Collateral'}
                </p>
                <p className="text-foreground font-mono">
                  {order.orderType === 'StopLimit'
                    ? formatUSD(order.limitPrice, 2)
                    : order.hasPosition
                    ? '—'
                    : `${order.collateral.toFixed(2)} USDC`}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 text-xs">Slippage</p>
                <p className="text-foreground font-mono">
                  {(order.slippageToleranceBps / 100).toFixed(1)}%
                </p>
              </div>
            </div>

            <Button
              variant="danger"
              size="sm"
              className="w-full"
              onClick={() => {
                setSelectedOrder(order);
                setIsCancelModalOpen(true);
              }}
            >
              <X className="w-4 h-4 mr-1" />
              Cancel Order
            </Button>
          </Card>
        ))}

        {/* Mobile History */}
        {historyOrders.length > 0 && (
          <>
            {pendingOrders.length > 0 && (
              <div className="border-t border-border my-2" />
            )}
            {historyOrders.map((order) => (
              <Card key={order.id} padding="md" className="opacity-60">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className={cn('inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm text-[11px] font-medium', getOrderTypeColor(order.orderType))}>
                      {getOrderTypeIcon(order.orderType)}
                      {getOrderTypeLabel(order.orderType)}
                    </div>
                    <span className="font-medium text-foreground text-sm">{order.asset}</span>
                    <Badge variant={order.direction === 'Long' ? 'success' : 'danger'} size="sm">
                      {order.direction}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">{formatRelativeTime(order.createdAt)}</span>
                    {getStatusBadge(order.status)}
                  </div>
                </div>
              </Card>
            ))}
          </>
        )}
      </div>

      {/* Cancel Order Modal */}
      <Modal
        isOpen={isCancelModalOpen}
        onClose={() => setIsCancelModalOpen(false)}
        title="Cancel Order"
        size="sm"
      >
        {selectedOrder && (
          <div>
            <div className="mb-6 p-4 bg-surface-2 rounded-lg space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Order Type</span>
                <span className="text-foreground">
                  {getOrderTypeLabel(selectedOrder.orderType)} {selectedOrder.asset} {selectedOrder.direction}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Size</span>
                <span className="text-foreground">{formatUSD(selectedOrder.positionSize)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Trigger Price</span>
                <span className="text-foreground">{formatUSD(selectedOrder.triggerPrice, 2)}</span>
              </div>
              {selectedOrder.orderType === 'LimitEntry' && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Collateral</span>
                  <span className="text-foreground">{selectedOrder.collateral.toFixed(2)} USDC</span>
                </div>
              )}
            </div>

            {selectedOrder.orderType === 'LimitEntry' && (
              <p className="text-sm text-muted-foreground mb-4">
                Your collateral of {selectedOrder.collateral.toFixed(2)} USDC will be refunded.
              </p>
            )}

            <div className="flex gap-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setIsCancelModalOpen(false)}
                disabled={isCancelling}
              >
                Keep Order
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                onClick={handleCancel}
                disabled={isCancelling}
                isLoading={isCancelling}
              >
                {isCancelling ? 'Cancelling...' : 'Cancel Order'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
