'use client';

import { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/layout';
import { WalletProvider } from '@/components/wallet';
import { AccountHealth, PnlChart, AssetAllocation, PortfolioHistory } from '@/components/portfolio';
import { useWallet } from '@/lib/hooks/useWallet';
import { getPositions, toDisplayPosition, getTradeHistory } from '@/lib/stellar/market';
import { getPrice, priceToDisplay } from '@/lib/stellar/oracle';
import type { DisplayPosition, Trade } from '@/types';

function PortfolioPage() {
  const { isConnected, publicKey } = useWallet();

  const [positions, setPositions] = useState<DisplayPosition[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState(true);
  const [isLoadingTrades, setIsLoadingTrades] = useState(true);
  const [usdcBalance, setUsdcBalance] = useState(0);

  // Fetch positions from Soroban contract
  const fetchPositions = useCallback(async () => {
    if (!publicKey) {
      setPositions([]);
      setIsLoadingPositions(false);
      return;
    }

    setIsLoadingPositions(true);
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
    }
  }, [publicKey]);

  // Fetch trade history
  const fetchTrades = useCallback(async () => {
    if (!publicKey) {
      setTrades([]);
      setIsLoadingTrades(false);
      return;
    }

    setIsLoadingTrades(true);
    try {
      const tradeHistory = await getTradeHistory(publicKey);
      setTrades(tradeHistory);
    } catch (error) {
      console.error('Failed to fetch trade history:', error);
    } finally {
      setIsLoadingTrades(false);
    }
  }, [publicKey]);

  // Load data on connect
  useEffect(() => {
    if (isConnected && publicKey) {
      fetchPositions();
      fetchTrades();
    } else {
      setPositions([]);
      setTrades([]);
      setIsLoadingPositions(false);
      setIsLoadingTrades(false);
    }
  }, [isConnected, publicKey, fetchPositions, fetchTrades]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (!isConnected || !publicKey) return;

    const interval = setInterval(() => {
      fetchPositions();
    }, 60000);

    return () => clearInterval(interval);
  }, [isConnected, publicKey, fetchPositions]);

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Header />

      <main className="pt-16 pb-20">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
          {/* Row 1 - Account Health */}
          <AccountHealth
            positions={positions}
            usdcBalance={usdcBalance}
            isConnected={isConnected}
          />

          {/* Row 2 - Performance & Allocation */}
          <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-8">
            <PnlChart trades={trades} />
            <AssetAllocation positions={positions} usdcBalance={usdcBalance} />
          </div>

          {/* Row 3 - History Table */}
          <PortfolioHistory
            trades={trades}
            transfers={[]}
            isLoading={isLoadingTrades}
          />
        </div>
      </main>
    </div>
  );
}

export default function PortfolioPageWrapper() {
  return (
    <WalletProvider>
      <PortfolioPage />
    </WalletProvider>
  );
}
