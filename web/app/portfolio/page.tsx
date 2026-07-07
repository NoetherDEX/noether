'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Header } from '@/components/layout';
import { WalletProvider } from '@/components/wallet';
import { AccountHealth, PnlChart, AssetAllocation, PortfolioHistory } from '@/components/portfolio';
import { useWallet } from '@/lib/hooks/useWallet';
import { getPositions, toDisplayPosition, getTradeHistory, getCrossMarginBalance } from '@/lib/stellar/market';
import { getPrice, priceToDisplay } from '@/lib/stellar/oracle';
import { fromPrecision } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import type { DisplayPosition, Trade } from '@/types';

function PortfolioPage() {
  const { isConnected, publicKey, usdcBalance } = useWallet();

  const [positions, setPositions] = useState<DisplayPosition[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState(true);
  const [isLoadingTrades, setIsLoadingTrades] = useState(true);
  // A9: the cross-margin pool balance is part of net worth. null = not read yet.
  const [crossMarginBalance, setCrossMarginBalance] = useState<number | null>(null);
  // A8: price health. "Stale" assets render from the last good price after a
  // failed oracle read; "missing" assets have no known price at all, so their
  // PnL is unknown — never fabricated as $0.
  const [staleAssets, setStaleAssets] = useState<string[]>([]);
  const [missingAssets, setMissingAssets] = useState<string[]>([]);
  const [unpricedCollateral, setUnpricedCollateral] = useState(0);
  const [unpricedCount, setUnpricedCount] = useState(0);
  const [positionsError, setPositionsError] = useState(false);
  const [tradesError, setTradesError] = useState(false);
  // Last successful oracle read per asset, kept across refresh cycles.
  const lastGoodPricesRef = useRef<Record<string, number>>({});

  // Fetch positions + cross-margin balance from Soroban contract
  const fetchPositions = useCallback(async () => {
    if (!publicKey) {
      setPositions([]);
      setCrossMarginBalance(null);
      setStaleAssets([]);
      setMissingAssets([]);
      setUnpricedCollateral(0);
      setUnpricedCount(0);
      setPositionsError(false);
      setIsLoadingPositions(false);
      return;
    }

    setIsLoadingPositions(true);
    try {
      const [contractPositions, crossBalanceRaw] = await Promise.all([
        getPositions(publicKey),
        getCrossMarginBalance(publicKey),
      ]);
      setCrossMarginBalance(crossBalanceRaw != null ? fromPrecision(crossBalanceRaw) : null);

      // Fetch current prices for all unique assets. A failed read falls back
      // to the last good price (flagged stale); with no last-good price the
      // asset is unpriced and its PnL is unknown.
      const uniqueAssets = Array.from(new Set(contractPositions.map(p => p.asset)));
      const priceMap: Record<string, number> = {};
      const stale: string[] = [];
      const missing: string[] = [];

      await Promise.all(
        uniqueAssets.map(async (asset) => {
          const priceData = await getPrice(publicKey, asset);
          if (priceData) {
            const price = priceToDisplay(priceData.price);
            priceMap[asset] = price;
            lastGoodPricesRef.current[asset] = price;
          } else if (lastGoodPricesRef.current[asset] !== undefined) {
            priceMap[asset] = lastGoodPricesRef.current[asset];
            stale.push(asset);
          } else {
            missing.push(asset);
          }
        })
      );

      // Convert to display positions. Positions without any known price are
      // excluded from price-derived math (their PnL is unknown, not $0);
      // their collateral is still real money and is counted separately.
      const priced: DisplayPosition[] = [];
      let hiddenCollateral = 0;
      let hiddenCount = 0;
      for (const p of contractPositions) {
        const price = priceMap[p.asset];
        if (price !== undefined && price > 0) {
          priced.push(toDisplayPosition(p, price));
        } else {
          hiddenCollateral += fromPrecision(p.collateral);
          hiddenCount += 1;
        }
      }

      setPositions(priced);
      setStaleAssets(stale);
      setMissingAssets(missing);
      setUnpricedCollateral(hiddenCollateral);
      setUnpricedCount(hiddenCount);
      setPositionsError(false);
    } catch (error) {
      console.error('Failed to fetch positions:', error);
      // Keep the last known data on screen; surface a retryable banner.
      setPositionsError(true);
    } finally {
      setIsLoadingPositions(false);
    }
  }, [publicKey]);

  // Fetch trade history
  const fetchTrades = useCallback(async () => {
    if (!publicKey) {
      setTrades([]);
      setTradesError(false);
      setIsLoadingTrades(false);
      return;
    }

    setIsLoadingTrades(true);
    try {
      const tradeHistory = await getTradeHistory(publicKey);
      setTrades(tradeHistory);
      setTradesError(false);
    } catch (error) {
      console.error('Failed to fetch trade history:', error);
      setTradesError(true);
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
      setCrossMarginBalance(null);
      setStaleAssets([]);
      setMissingAssets([]);
      setUnpricedCollateral(0);
      setUnpricedCount(0);
      setPositionsError(false);
      setTradesError(false);
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

  const retry = () => {
    fetchPositions();
    fetchTrades();
  };
  const isRetrying = isLoadingPositions || isLoadingTrades;

  // A8: retryable degraded-data banner (failed loads, missing/stale prices)
  const bannerMessages: string[] = [];
  if (positionsError) bannerMessages.push("Couldn't refresh positions.");
  if (tradesError) bannerMessages.push("Couldn't load trade history.");
  if (missingAssets.length > 0)
    bannerMessages.push(`Live price unavailable for ${missingAssets.join(', ')} — PnL is shown as “—”.`);
  if (staleAssets.length > 0)
    bannerMessages.push(`Showing last known price for ${staleAssets.join(', ')}.`);

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Header />

      <main className="pt-16 pb-20">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
          {/* Degraded-data banner */}
          {isConnected && bannerMessages.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-[#f59e0b]/30 bg-[#f59e0b]/10 px-4 py-3">
              <div className="flex items-start gap-2 text-sm text-[#f59e0b]">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{bannerMessages.join(' ')}</span>
              </div>
              <button
                onClick={retry}
                disabled={isRetrying}
                className="inline-flex items-center gap-1.5 self-start sm:self-auto px-3 py-1.5 text-xs font-medium rounded-lg border border-[#f59e0b]/30 text-[#f59e0b] hover:bg-[#f59e0b]/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', isRetrying && 'animate-spin')} />
                Retry
              </button>
            </div>
          )}

          {/* Row 1 - Account Health */}
          <AccountHealth
            positions={positions}
            usdcBalance={usdcBalance}
            isConnected={isConnected}
            crossMarginBalance={crossMarginBalance}
            unpricedCollateral={unpricedCollateral}
            unpricedCount={unpricedCount}
            pricesStale={staleAssets.length > 0}
          />

          {/* Row 2 - Performance & Allocation */}
          <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-8">
            <PnlChart trades={trades} />
            <AssetAllocation positions={positions} usdcBalance={usdcBalance} staleAssets={staleAssets} />
          </div>

          {/* Row 3 - History Table */}
          <PortfolioHistory
            trades={trades}
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
