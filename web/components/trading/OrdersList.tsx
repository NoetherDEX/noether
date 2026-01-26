'use client';

import { useState } from 'react';
import { Clock, X, RefreshCw, Shield, Target, ArrowDownCircle } from 'lucide-react';
import { Button, Badge, Modal, Card } from '@/components/ui';
import { formatUSD, formatDateTime } from '@/lib/utils';
import { cn } from '@/lib/utils/cn';
import type { DisplayOrder } from '@/types';

interface OrdersListProps {
  orders: DisplayOrder[];
  isLoading?: boolean;
  isRefreshing?: boolean;
  onCancelOrder?: (id: number) => Promise<void>;
  onRefresh?: () => void;
}

export function OrdersList({
  orders,
  isLoading,
  isRefreshing,
  onCancelOrder,
  onRefresh,
}: OrdersListProps) {
  const [selectedOrder, setSelectedOrder] = useState<DisplayOrder | null>(null);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // Filter only pending orders
  const pendingOrders = orders.filter((o) => o.status === 'Pending');

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <div
            key={i}
            className="h-14 bg-white/5 rounded-lg animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (pendingOrders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="relative mb-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-500/10 to-orange-500/10 flex items-center justify-center">
            <Clock className="w-7 h-7 text-muted-foreground/50" />
          </div>
        </div>
        <h3 className="text-foreground font-medium mb-1">No pending orders</h3>
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

  const getOrderTypeLabel = (orderType: string) => {
    switch (orderType) {
      case 'LimitEntry':
        return 'Limit';
      case 'StopLoss':
        return 'SL';
      case 'TakeProfit':
        return 'TP';
      default:
        return orderType;
    }
  };

  const getOrderTypeColor = (orderType: string) => {
    switch (orderType) {
      case 'StopLoss':
        return 'text-[#ef4444] bg-[#ef4444]/10';
      case 'TakeProfit':
        return 'text-[#22c55e] bg-[#22c55e]/10';
      default:
        return 'text-amber-500 bg-amber-500/10';
    }
  };

  return (
    <>
      {/* Header with Refresh Button */}
      {pendingOrders.length > 0 && (
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-muted-foreground">
            {pendingOrders.length} pending order{pendingOrders.length !== 1 ? 's' : ''}
          </span>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all',
                'text-muted-foreground hover:text-foreground hover:bg-white/5',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
              title="Refresh orders"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          )}
        </div>
      )}

      {/* Desktop Table */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="text-muted-foreground border-b border-white/5">
              <th className="text-left px-3 py-2.5 font-medium">Type</th>
              <th className="text-left px-3 py-2.5 font-medium">Market</th>
              <th className="text-right px-3 py-2.5 font-medium">Size</th>
              <th className="text-right px-3 py-2.5 font-medium">Trigger Price</th>
              <th className="text-right px-3 py-2.5 font-medium">Slippage</th>
              <th className="text-right px-3 py-2.5 font-medium">Created</th>
              <th className="text-center px-3 py-2.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pendingOrders.map((order) => (
              <tr
                key={order.id}
                className="border-b border-white/5 hover:bg-white/[0.03] transition-colors"
              >
                <td className="px-3 py-3">
                  <div className={cn('inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium', getOrderTypeColor(order.orderType))}>
                    {getOrderTypeIcon(order.orderType)}
                    {getOrderTypeLabel(order.orderType)}
                  </div>
                </td>

                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{order.asset}-PERP</span>
                    <span
                      className={cn(
                        'px-1.5 py-0.5 rounded text-[10px] font-bold font-mono',
                        order.direction === 'Long'
                          ? 'bg-[#22c55e]/15 text-[#22c55e] ring-1 ring-[#22c55e]/30'
                          : 'bg-[#ef4444]/15 text-[#ef4444] ring-1 ring-[#ef4444]/30'
                      )}
                    >
                      {order.leverage}x
                    </span>
                  </div>
                  <span
                    className={cn(
                      'text-[10px] font-medium',
                      order.direction === 'Long' ? 'text-[#22c55e]' : 'text-[#ef4444]'
                    )}
                  >
                    {order.direction.toUpperCase()}
                  </span>
                </td>

                <td className="px-3 py-3 text-right">
                  <div className="font-mono text-foreground">
                    ${order.positionSize.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                  <div className="font-mono text-muted-foreground text-[10px]">
                    {order.collateral.toFixed(2)} USDC
                  </div>
                </td>

                <td className="px-3 py-3 text-right">
                  <div className="font-mono text-foreground">
                    {formatUSD(order.triggerPrice, order.asset === 'XLM' ? 4 : 2)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {order.triggerCondition}
                  </div>
                </td>

                <td className="px-3 py-3 text-right">
                  <span className="font-mono text-muted-foreground">
                    {(order.slippageToleranceBps / 100).toFixed(1)}%
                  </span>
                </td>

                <td className="px-3 py-3 text-right">
                  <span className="text-muted-foreground text-[10px]">
                    {formatDateTime(order.createdAt)}
                  </span>
                </td>

                <td className="px-3 py-3">
                  <div className="flex items-center justify-center">
                    <button
                      onClick={() => {
                        setSelectedOrder(order);
                        setIsCancelModalOpen(true);
                      }}
                      className="px-2.5 py-1 rounded text-[10px] font-medium bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/20 transition-colors flex items-center gap-1"
                      title="Cancel Order"
                    >
                      <X className="w-3 h-3" />
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="lg:hidden space-y-3">
        {pendingOrders.map((order) => (
          <Card key={order.id} padding="md">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className={cn('inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium', getOrderTypeColor(order.orderType))}>
                    {getOrderTypeIcon(order.orderType)}
                    {getOrderTypeLabel(order.orderType)}
                  </div>
                  <span className="font-semibold text-foreground">{order.asset}</span>
                  <Badge variant={order.direction === 'Long' ? 'success' : 'danger'} size="sm">
                    {order.direction} {order.leverage}x
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(order.createdAt)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              <div>
                <p className="text-muted-foreground mb-1 text-xs">Size</p>
                <p className="text-foreground font-mono">{formatUSD(order.positionSize)}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 text-xs">Trigger</p>
                <p className="text-foreground font-mono">
                  {formatUSD(order.triggerPrice, 2)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 text-xs">Collateral</p>
                <p className="text-foreground font-mono">{order.collateral.toFixed(2)} USDC</p>
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
            <div className="mb-6 p-4 bg-white/5 rounded-xl space-y-2">
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
