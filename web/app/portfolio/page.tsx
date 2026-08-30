'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { retryProgressMessage } from '@/lib/utils/txCopy';
import type { TradeProgress } from '@/lib/stellar/txFlow';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Header } from '@/components/layout';
import { WalletProvider } from '@/components/wallet';
import { AccountHealth, PnlChart, AssetAllocation, PortfolioHistory } from '@/components/portfolio';
import { PositionsList } from '@/components/trading';
import { useWallet } from '@/lib/hooks/useWallet';
import {
  getPositions,
  toDisplayPosition,
  getTradeHistory,
  getCrossMarginBalance,
  closePosition,
  closePositionCross,
  closePositionPartial,
  addCollateral,
  removeCollateral,
  closeAcceptableBound,
} from '@/lib/stellar/market';
import { marketHasBatch1Features } from '@/lib/stellar/capabilities';
import { ShortfallCard } from '@/components/portfolio/ShortfallCard';
import { getPrice, priceToDisplay } from '@/lib/stellar/oracle';
import { listTrades, toTrade } from '@/lib/api/trades';
import { gatewayServesThisMarket } from '@/lib/api/gateway';
import { fromPrecision } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import type { DisplayPosition, Trade } from '@/types';

function PortfolioPage() {
  const { isConnected, publicKey, usdcBalance, sign, refreshBalances } = useWallet();
  const router = useRouter();

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

  // Fetch positions + cross-margin balance from Soroban contract.
  // showLoading=false for background refreshes — skeletons on first load
  // only, so the 60s tick stops flashing the whole page (B12).
  const fetchPositions = useCallback(async (showLoading = true) => {
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

    if (showLoading) setIsLoadingPositions(true);
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
      // Gateway feed first (one HTTPS call, same trust gate as the trade
      // page); legacy Horizon meta-XDR parse only as fallback.
      let tradeHistory: Trade[] | null = null;
      if (await gatewayServesThisMarket()) {
        try {
          tradeHistory = (await listTrades({ trader: publicKey, limit: 100 })).map(toTrade);
        } catch {
          tradeHistory = null; // gateway hiccup — legacy path below
        }
      }
      if (tradeHistory === null) tradeHistory = await getTradeHistory(publicKey);
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

  // Auto-refresh every 60 seconds — trades and wallet balances refresh with
  // positions (B12: the history/net-worth used to drift until a manual
  // reload), and no skeleton flash on background ticks.
  useEffect(() => {
    if (!isConnected || !publicKey) return;

    const interval = setInterval(() => {
      fetchPositions(false);
      fetchTrades();
      refreshBalances();
    }, 60000);

    return () => clearInterval(interval);
  }, [isConnected, publicKey, fetchPositions, fetchTrades, refreshBalances]);

  const retry = () => {
    fetchPositions();
    fetchTrades();
  };
  const isRetrying = isLoadingPositions || isLoadingTrades;

  // L0-6/L0-15 (Batch-1) capability probe — gates partial close + margin edit.
  const [batch1Features, setBatch1Features] = useState(false);
  useEffect(() => {
    let cancelled = false;
    marketHasBatch1Features()
      .then((ok) => {
        if (!cancelled) setBatch1Features(ok);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // B12: the account page manages exposure — closing here uses the exact
  // toast.promise lifecycle /trade uses, then refreshes everything.
  const handleClosePosition = async (positionId: number): Promise<void> => {
    if (!publicKey) return;
    const pos = positions.find((p) => p.id === positionId);
    const label = pos ? `${pos.asset} ${pos.direction}` : `position #${positionId}`;

    const closePromise = (async (): Promise<bigint | null> => {
      // L0-10 (Batch-1): bound the exit at 1% from the last displayed mark;
      // 0 (unbounded) when no live mark. Inert pre-Batch-1.
      const bound = pos
        ? closeAcceptableBound(pos.direction, pos.currentPrice)
        : BigInt(0);
      const flow = {
        onProgress: (p: TradeProgress) => {
          if (p === 'retrying') toast(retryProgressMessage('close'), { id: `retry-close-${positionId}`, icon: '⟳' });
        },
      };
      if (pos?.marginMode === 'Cross') {
        const result = await closePositionCross(publicKey, sign, positionId, bound, flow);
        return result.pnl;
      }
      const result = await closePosition(publicKey, sign, positionId, pos?.asset ?? 'BTC', bound, flow);
      return result.pnl;
    })();

    toast.promise(closePromise, {
      loading: `Closing ${label}…`,
      success: (pnl) => {
        fetchPositions(false);
        fetchTrades();
        refreshBalances();
        if (pnl === null) return `${label} closed`;
        const pnlUsd = fromPrecision(pnl);
        return `${label} closed — PnL ${pnlUsd >= 0 ? '+' : '−'}$${Math.abs(pnlUsd).toFixed(2)}`;
      },
      error: (err) => (err instanceof Error ? err.message : 'Failed to close position'),
    });

    await closePromise.catch(() => {});
  };

  // L0-6 (Batch-1): partial close + margin management, /trade-style lifecycle.
  const handleClosePartial = async (positionId: number, closeSize: bigint): Promise<void> => {
    if (!publicKey) return;
    const pos = positions.find((p) => p.id === positionId);
    const label = pos ? `${pos.asset} ${pos.direction}` : `position #${positionId}`;
    const pct = pos && pos.size > 0 ? `${Math.round((fromPrecision(closeSize) / pos.size) * 100)}%` : 'part';

    const promise = closePositionPartial(publicKey, sign, positionId, closeSize, pos?.asset ?? 'BTC');
    toast.promise(promise, {
      loading: `Closing ${pct} of ${label}…`,
      success: (pnl) => {
        fetchPositions(false);
        fetchTrades();
        refreshBalances();
        const pnlUsd = fromPrecision(pnl);
        return `Closed ${pct} of ${label} — PnL ${pnlUsd >= 0 ? '+' : '−'}$${Math.abs(pnlUsd).toFixed(2)}`;
      },
      error: (err) => (err instanceof Error ? err.message : 'Failed to partially close position'),
    });
    await promise.catch(() => {});
  };

  const handleAddCollateral = async (positionId: number, amount: bigint): Promise<void> => {
    if (!publicKey) return;
    const promise = addCollateral(publicKey, sign, positionId, amount);
    toast.promise(promise, {
      loading: 'Adding margin…',
      success: () => {
        fetchPositions(false);
        refreshBalances();
        return `Margin added to position #${positionId}`;
      },
      error: (err) => (err instanceof Error ? err.message : 'Failed to add margin'),
    });
    await promise.catch(() => {});
  };

  const handleRemoveCollateral = async (positionId: number, amount: bigint): Promise<void> => {
    if (!publicKey) return;
    const promise = removeCollateral(publicKey, sign, positionId, amount);
    toast.promise(promise, {
      loading: 'Removing margin…',
      success: () => {
        fetchPositions(false);
        refreshBalances();
        return `Margin removed from position #${positionId}`;
      },
      error: (err) => (err instanceof Error ? err.message : 'Failed to remove margin'),
    });
    await promise.catch(() => {});
  };

  // A8: retryable degraded-data banner (failed loads, missing/stale prices)
  const bannerMessages: string[] = [];
  if (positionsError) bannerMessages.push("Couldn't refresh positions.");
  if (tradesError) bannerMessages.push("Couldn't load trade history.");
  if (missingAssets.length > 0)
    bannerMessages.push(`Live price unavailable for ${missingAssets.join(', ')} — PnL is shown as “—”.`);
  if (staleAssets.length > 0)
    bannerMessages.push(`Showing last known price for ${staleAssets.join(', ')}.`);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="pt-12 pb-16">
        {/* B29: screen-reader page title — visual hierarchy starts at the cards */}
        <h1 className="sr-only">Portfolio — Noether</h1>
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
          {/* Degraded-data banner */}
          {isConnected && bannerMessages.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3">
              <div className="flex items-start gap-2 text-sm text-primary">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{bannerMessages.join(' ')}</span>
              </div>
              <button
                onClick={retry}
                disabled={isRetrying}
                className="inline-flex items-center gap-1.5 self-start sm:self-auto px-3 py-1.5 text-xs font-medium rounded-md border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

          {/* L0-3 (Batch-1): claimable shortfall — renders only when the
              vault actually owes this wallet. */}
          {isConnected && publicKey && (
            <ShortfallCard publicKey={publicKey} sign={sign} onClaimed={refreshBalances} />
          )}

          {/* Row 1.5 — Open Positions with real management actions (B12):
              traders expect the account page to manage exposure, not
              context-switch to /trade for every close. */}
          {isConnected && (
            <div className="rounded-lg border border-border bg-surface p-4">
              <h2 className="text-[13px] font-medium text-foreground mb-3">Open Positions</h2>
              <PositionsList
                positions={positions}
                isLoading={isLoadingPositions}
                onClosePosition={handleClosePosition}
                onClosePartial={handleClosePartial}
                onAddCollateral={handleAddCollateral}
                onRemoveCollateral={handleRemoveCollateral}
                batch1Features={batch1Features}
                onRefresh={retry}
                onStartTrading={() => router.push('/trade')}
              />
            </div>
          )}

          {/* Row 2 - Performance & Allocation */}
          <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">
            <PnlChart trades={trades} isLoading={isLoadingTrades} hasError={tradesError} />
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
