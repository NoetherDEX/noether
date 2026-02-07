'use client';

import { useState, useEffect, useCallback } from 'react';
import { Settings, Clock } from 'lucide-react';
import { Card, Tabs } from '@/components/ui';
import { Header } from '@/components/layout';
import { WalletProvider } from '@/components/wallet';
import {
  TradingChart,
  ChartHeader,
  OrderPanel,
  AssetSelector,
  AssetSelectorDropdown,
  PositionsList,
  OrdersList,
  TradeHistoryContainer,
  RecentTrades,
  OrderBook,
} from '@/components/trading';
import { useWallet } from '@/lib/hooks/useWallet';
import { TIMEFRAMES } from '@/lib/utils/constants';
import { cn } from '@/lib/utils/cn';
import {
  getPositions,
  toDisplayPosition,
  closePosition,
  getOrders,
  toDisplayOrder,
  setStopLoss,
  setTakeProfit,
  cancelOrder,
} from '@/lib/stellar/market';
import { getPrice, priceToDisplay } from '@/lib/stellar/oracle';
import { toPrecision } from '@/lib/utils';
import type { DisplayPosition, DisplayOrder } from '@/types';
import toast from 'react-hot-toast';

function TradePage() {
  const [selectedAsset, setSelectedAsset] = useState('BTC');
  const [selectedTimeframe, setSelectedTimeframe] = useState('1h');
  const [positions, setPositions] = useState<DisplayPosition[]>([]);
  const [orders, setOrders] = useState<DisplayOrder[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRefreshingOrders, setIsRefreshingOrders] = useState(false);

  const { isConnected, publicKey, sign, refreshBalances } = useWallet();

  // Fetch positions function - extracted for manual refresh
  const fetchPositions = useCallback(async (showLoading = true) => {
    if (!publicKey) return;

    if (showLoading) setIsLoadingPositions(true);
    setIsRefreshing(true);

    try {
      // Fetch positions from contract
      const contractPositions = await getPositions(publicKey);

      if (contractPositions.length === 0) {
        setPositions([]);
        return;
      }

      // Fetch current prices for all unique assets
      const uniqueAssets = Array.from(new Set(contractPositions.map(p => p.asset)));
      const priceMap: Record<string, number> = {};

      await Promise.all(
        uniqueAssets.map(async (asset) => {
          const priceData = await getPrice(publicKey, asset);
          if (priceData) {
            priceMap[asset] = priceToDisplay(priceData.price);
          }
        })
      );

      // Convert to display positions
      const displayPositions = contractPositions.map(p =>
        toDisplayPosition(p, priceMap[p.asset] || 0)
      );

      setPositions(displayPositions);
    } catch (error) {
      console.error('Failed to fetch positions:', error);
    } finally {
      setIsLoadingPositions(false);
      setIsRefreshing(false);
    }
  }, [publicKey]);

  // Manual refresh handler
  const handleRefreshPositions = useCallback(() => {
    fetchPositions(false); // Don't show full loading state for manual refresh
  }, [fetchPositions]);

  // Fetch orders function
  const fetchOrders = useCallback(async (showLoading = true) => {
    if (!publicKey) return;

    if (showLoading) setIsLoadingOrders(true);
    setIsRefreshingOrders(true);

    try {
      const contractOrders = await getOrders(publicKey);
      const displayOrders = contractOrders.map(toDisplayOrder);
      setOrders(displayOrders);
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    } finally {
      setIsLoadingOrders(false);
      setIsRefreshingOrders(false);
    }
  }, [publicKey]);

  // Manual refresh handler for orders
  const handleRefreshOrders = useCallback(() => {
    fetchOrders(false);
  }, [fetchOrders]);

  // Auto-refresh positions and orders every 60 seconds when connected
  useEffect(() => {
    if (!isConnected || !publicKey) {
      setPositions([]);
      setOrders([]);
      return;
    }

    fetchPositions(true); // Initial fetch with loading state
    fetchOrders(true);
    const interval = setInterval(() => {
      fetchPositions(false);
      fetchOrders(false);
    }, 60000); // 60 seconds
    return () => clearInterval(interval);
  }, [isConnected, publicKey, fetchPositions, fetchOrders]);

  const handleClosePosition = async (positionId: number): Promise<void> => {
    if (!publicKey) throw new Error('Wallet not connected');

    try {
      const result = await closePosition(publicKey, sign, positionId);
      console.log('Position closed:', result);

      // Refresh positions and balances
      await fetchPositions(false);
      refreshBalances();
    } catch (error) {
      console.error('Failed to close position:', error);
      throw error; // Re-throw so the modal knows it failed
    }
  };

  const handleAddCollateral = async (positionId: number, amount: number) => {
    // TODO: Implement add collateral
    console.log('Adding collateral:', positionId, amount);
  };

  const handleSetStopLoss = async (positionId: number, triggerPrice: number, slippageBps: number): Promise<void> => {
    if (!publicKey) throw new Error('Wallet not connected');

    const promise = setStopLoss(publicKey, sign, {
      positionId,
      triggerPrice: toPrecision(triggerPrice),
      slippageToleranceBps: slippageBps,
    });

    toast.promise(promise, {
      loading: 'Setting stop-loss...',
      success: (order) => {
        fetchOrders(false);
        return `Stop-loss set at $${triggerPrice.toFixed(2)}`;
      },
      error: (err) => {
        console.error('Failed to set stop-loss:', err);
        return err?.message || 'Failed to set stop-loss';
      },
    });

    await promise;
  };

  const handleSetTakeProfit = async (positionId: number, triggerPrice: number, slippageBps: number): Promise<void> => {
    if (!publicKey) throw new Error('Wallet not connected');

    const promise = setTakeProfit(publicKey, sign, {
      positionId,
      triggerPrice: toPrecision(triggerPrice),
      slippageToleranceBps: slippageBps,
    });

    toast.promise(promise, {
      loading: 'Setting take-profit...',
      success: (order) => {
        fetchOrders(false);
        return `Take-profit set at $${triggerPrice.toFixed(2)}`;
      },
      error: (err) => {
        console.error('Failed to set take-profit:', err);
        return err?.message || 'Failed to set take-profit';
      },
    });

    await promise;
  };

  const handleCancelOrder = async (orderId: number): Promise<void> => {
    if (!publicKey) throw new Error('Wallet not connected');

    const promise = cancelOrder(publicKey, sign, orderId);

    toast.promise(promise, {
      loading: 'Cancelling order...',
      success: () => {
        fetchOrders(false);
        refreshBalances(); // Refund collateral for limit orders
        return 'Order cancelled successfully';
      },
      error: (err) => {
        console.error('Failed to cancel order:', err);
        return err?.message || 'Failed to cancel order';
      },
    });

    await promise;
  };

  // Count only pending orders for the badge
  const pendingOrdersCount = orders.filter(o => o.status === 'Pending').length;

  const positionTabs = [
    {
      id: 'positions',
      label: 'Positions',
      count: positions.length,
      content: (
        <PositionsList
          positions={positions}
          isLoading={isLoadingPositions}
          isRefreshing={isRefreshing}
          onClosePosition={handleClosePosition}
          onAddCollateral={handleAddCollateral}
          onSetStopLoss={handleSetStopLoss}
          onSetTakeProfit={handleSetTakeProfit}
          onRefresh={handleRefreshPositions}
        />
      ),
    },
    {
      id: 'orders',
      label: 'Orders',
      count: pendingOrdersCount,
      content: (
        <OrdersList
          orders={orders}
          isLoading={isLoadingOrders}
          isRefreshing={isRefreshingOrders}
          onCancelOrder={handleCancelOrder}
          onRefresh={handleRefreshOrders}
        />
      ),
    },
    {
      id: 'history',
      label: 'Trade History',
      content: <TradeHistoryContainer />,
    },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Header />

      <main className="pt-16">
        <div className="max-w-[1800px] mx-auto p-4 lg:p-6">
          {/* Main Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
            {/* Left Sidebar - Split: OrderBook (Top) + Recent Trades (Bottom) */}
            <div className="hidden xl:block xl:col-span-2">
              <div className="sticky top-20 flex flex-col gap-4 h-[calc(100vh-120px)]">
                {/* Top Half: Order Book */}
                <Card className="flex-1 min-h-0 overflow-hidden">
                  <OrderBook asset={selectedAsset} />
                </Card>

                {/* Bottom Half: Recent Trades (Global Activity) */}
                <Card className="flex-1 min-h-0 overflow-hidden flex flex-col">
                  <RecentTrades />
                </Card>
              </div>
            </div>

            {/* Main Content */}
            <div className="lg:col-span-8 xl:col-span-7 space-y-4">
              {/* Chart Card */}
              <Card padding="none" className="overflow-hidden">
                {/* Chart Header with Asset Selector */}
                <div className="border-b border-white/5">
                  <div className="flex items-center justify-between px-4 py-2">
                    {/* Asset Selector Dropdown */}
                    <AssetSelectorDropdown
                      selectedAsset={selectedAsset}
                      onSelect={setSelectedAsset}
                    />
                    {/* Chart Header Stats (price, change, etc.) */}
                    <div className="hidden sm:block">
                      <ChartHeader asset={selectedAsset} compact />
                    </div>
                  </div>
                </div>

                {/* Timeframe Selector */}
                <div className="flex items-center gap-1 px-4 py-2 border-b border-white/5 overflow-x-auto">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf.value}
                      onClick={() => setSelectedTimeframe(tf.value)}
                      className={cn(
                        'px-3 py-1.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap',
                        selectedTimeframe === tf.value
                          ? 'bg-white text-black'
                          : 'text-neutral-400 hover:text-white hover:bg-white/5'
                      )}
                    >
                      {tf.label}
                    </button>
                  ))}
                </div>

                {/* Chart */}
                <div className="h-[400px] lg:h-[500px]">
                  <TradingChart
                    asset={selectedAsset}
                    interval={selectedTimeframe}
                  />
                </div>
              </Card>

              {/* Mobile Asset Selector */}
              <div className="xl:hidden">
                <Card>
                  <h3 className="text-sm font-medium text-neutral-400 mb-4">Select Market</h3>
                  <AssetSelector
                    selectedAsset={selectedAsset}
                    onSelect={setSelectedAsset}
                  />
                </Card>
              </div>

              {/* Positions & History */}
              <Card>
                <Tabs tabs={positionTabs} defaultTab="positions" />
              </Card>
            </div>

            {/* Right Sidebar - Order Panel */}
            <div className="lg:col-span-4 xl:col-span-3">
              <div className="sticky top-20 space-y-4">
                <OrderPanel
                  asset={selectedAsset}
                  onPositionOpened={() => {
                    fetchPositions(false);
                    refreshBalances();
                  }}
                />

                {/* Market Stats */}
                <Card>
                  <h3 className="text-sm font-medium text-neutral-400 mb-4">Market Info</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-500">Open Interest</span>
                      <span className="text-white">$1.2M</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-500">24h Volume</span>
                      <span className="text-white">$890K</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-500">Funding Rate</span>
                      <span className="text-emerald-400">+0.01%</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-500">Max Leverage</span>
                      <span className="text-white">10x</span>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function TradePageWrapper() {
  return (
    <TradePage />
  );
}
