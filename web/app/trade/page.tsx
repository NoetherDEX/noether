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
  PositionsList,
  TradeHistoryContainer,
} from '@/components/trading';
import { useWallet } from '@/lib/hooks/useWallet';
import { TIMEFRAMES } from '@/lib/utils/constants';
import { cn } from '@/lib/utils/cn';
import { getPositions, toDisplayPosition, closePosition } from '@/lib/stellar/market';
import { getPrice, priceToDisplay } from '@/lib/stellar/oracle';
import type { DisplayPosition } from '@/types';

function TradePage() {
  const [selectedAsset, setSelectedAsset] = useState('BTC');
  const [selectedTimeframe, setSelectedTimeframe] = useState('1h');
  const [positions, setPositions] = useState<DisplayPosition[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const [isClosingPosition, setIsClosingPosition] = useState(false);

  const { isConnected, publicKey, sign, refreshBalances } = useWallet();

  // Fetch positions when connected
  useEffect(() => {
    if (!isConnected || !publicKey) {
      setPositions([]);
      return;
    }

    const fetchPositions = async () => {
      setIsLoadingPositions(true);
      try {
        // Fetch positions from contract
        const contractPositions = await getPositions(publicKey);

        if (contractPositions.length === 0) {
          setPositions([]);
          return;
        }

        // Fetch current prices for all unique assets
        const uniqueAssets = [...new Set(contractPositions.map(p => p.asset))];
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
      }
    };

    fetchPositions();
    const interval = setInterval(fetchPositions, 10000);
    return () => clearInterval(interval);
  }, [isConnected, publicKey]);

  const handleClosePosition = async (positionId: number) => {
    if (!publicKey || isClosingPosition) return;

    setIsClosingPosition(true);
    try {
      const result = await closePosition(publicKey, sign, positionId);
      console.log('Position closed:', result);

      // Refresh positions and balances
      const contractPositions = await getPositions(publicKey);
      const uniqueAssets = [...new Set(contractPositions.map(p => p.asset))];
      const priceMap: Record<string, number> = {};

      await Promise.all(
        uniqueAssets.map(async (asset) => {
          const priceData = await getPrice(publicKey, asset);
          if (priceData) {
            priceMap[asset] = priceToDisplay(priceData.price);
          }
        })
      );

      const displayPositions = contractPositions.map(p =>
        toDisplayPosition(p, priceMap[p.asset] || 0)
      );

      setPositions(displayPositions);
      refreshBalances();
    } catch (error) {
      console.error('Failed to close position:', error);
    } finally {
      setIsClosingPosition(false);
    }
  };

  const handleAddCollateral = async (positionId: number, amount: number) => {
    // TODO: Implement add collateral
    console.log('Adding collateral:', positionId, amount);
  };

  const positionTabs = [
    {
      id: 'positions',
      label: 'Positions',
      count: positions.length,
      content: (
        <PositionsList
          positions={positions}
          isLoading={isLoadingPositions}
          onClosePosition={handleClosePosition}
          onAddCollateral={handleAddCollateral}
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
    <div className="min-h-screen bg-[#09090b]">
      <Header />

      <main className="pt-16">
        <div className="max-w-[1800px] mx-auto p-4 lg:p-6">
          {/* Main Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
            {/* Left Sidebar - Asset Selector (Desktop) */}
            <div className="hidden xl:block xl:col-span-2">
              <Card className="sticky top-20">
                <h3 className="text-sm font-medium text-neutral-400 mb-4">Markets</h3>
                <AssetSelector
                  selectedAsset={selectedAsset}
                  onSelect={setSelectedAsset}
                />
              </Card>
            </div>

            {/* Main Content */}
            <div className="lg:col-span-8 xl:col-span-7 space-y-4">
              {/* Chart Card */}
              <Card padding="none" className="overflow-hidden">
                {/* Chart Header */}
                <div className="border-b border-white/5">
                  <ChartHeader asset={selectedAsset} />
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
                <OrderPanel asset={selectedAsset} />

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
    <WalletProvider>
      <TradePage />
    </WalletProvider>
  );
}
