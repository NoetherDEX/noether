'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { Card, Tabs, Tooltip } from '@/components/ui';
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
  CrossMarginBanner,
  MobileTradeBar,
} from '@/components/trading';
import { LeaderModeSelector } from '@/components/trading/LeaderModeSelector';
import { useLeaderModeStore } from '@/lib/store';
import { leaderClosePosition } from '@/lib/stellar/vaultFactory';
import { getVault } from '@/lib/api/vaults';
import { useSearchParams, useRouter } from 'next/navigation';
import { useWallet } from '@/lib/hooks/useWallet';
import { TIMEFRAMES } from '@/lib/utils/constants';
import { cn } from '@/lib/utils/cn';
import {
  getPositions,
  getPositionsByIds,
  toDisplayPosition,
  closePosition,
  closePositionCross,
  getOrders,
  toDisplayOrder,
  setStopLoss,
  setTakeProfit,
  cancelOrder,
  getFundingRate,
} from '@/lib/stellar/market';
import { listOpenPositions } from '@/lib/api/positions';
import { getMarketsStats, statToUsd, type AssetMarketStats } from '@/lib/api/markets';
import { getPrice, priceToDisplay } from '@/lib/stellar/oracle';
import { subscribeLivePrices } from '@/lib/stellar/noeracle';
import { toPrecision, fromPrecision } from '@/lib/utils';
import { formatCompactUsd, formatUSD, formatPercent } from '@/lib/utils/format';
import { decodeContractError } from '@/lib/utils/contractErrors';
import type { Position, DisplayPosition, DisplayOrder } from '@/types';
import toast from 'react-hot-toast';

function TradePage() {
  const [selectedAsset, setSelectedAsset] = useState('BTC');
  const [selectedTimeframe, setSelectedTimeframe] = useState('1h');
  // Raw contract positions. Refreshed on connect / vault-swap / explicit
  // trade actions / 60 s safety tick — NOT on every price update. The
  // displayed PnL / Mark / Net Value comes from currentPrices below.
  const [rawPositions, setRawPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<DisplayOrder[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRefreshingOrders, setIsRefreshingOrders] = useState(false);
  // null = unknown (RPC failure / entry absent) — rendered as '—', never a
  // healthy-looking +0.0000% (A14).
  const [fundingRate, setFundingRate] = useState<number | null>(null);
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});
  const [pricesStale, setPricesStale] = useState(false);
  const [assetStats, setAssetStats] = useState<AssetMarketStats | null>(null);
  const prevOrdersRef = useRef<Map<number, string>>(new Map());

  // Display positions are derived from raw positions + the latest prices,
  // so a price tick re-renders just the PnL / Mark / Net Value cells
  // (React reconciliation handles the in-place text update) without
  // re-fetching the whole position list from the contract.
  const positions = useMemo<DisplayPosition[]>(
    () => rawPositions.map(p => toDisplayPosition(p, currentPrices[p.asset] || 0)),
    [rawPositions, currentPrices],
  );

  const { isConnected, publicKey, walletId, sign, refreshBalances } = useWallet();
  const { vault: leaderVault, setVault: setLeaderVault } = useLeaderModeStore();
  const searchParams = useSearchParams();
  const router = useRouter();
  const factoryAddress = process.env.NEXT_PUBLIC_VAULT_FACTORY_ID || '';

  // ?vault={id} query — preselect leader mode for that vault if the
  // connected wallet is its leader. We always pull fresh data from
  // the API (not just on the first nav) because the store snapshot
  // saved by VaultActions is whatever the server rendered at the
  // time of the vault page load — by the time you reach /trade it
  // can be minutes stale, which made the "Vault balance" line lie
  // to the leader.
  useEffect(() => {
    const vaultId = searchParams?.get('vault');
    const id = vaultId != null ? Number(vaultId) : NaN;
    if (!publicKey) return;
    if (!Number.isInteger(id) || id < 0) return;
    getVault(id)
      .then((v) => {
        if (v && v.leader === publicKey) setLeaderVault(v);
      })
      .catch(() => {});
  }, [searchParams, publicKey, setLeaderVault]);

  // Real market stats (OI + 24h volume) from the indexer projection —
  // replaces the hardcoded $1.2M / $890K. Refetch on asset change + every
  // 30s; null result keeps the neutral placeholder.
  useEffect(() => {
    let active = true;
    const load = () => {
      getMarketsStats().then((stats) => {
        if (!active) return;
        setAssetStats(stats?.assets.find((a) => a.asset === selectedAsset) ?? null);
      });
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [selectedAsset]);

  // Fetch positions function - extracted for manual refresh
  const fetchPositions = useCallback(async (showLoading = true) => {
    if (!publicKey) return;

    if (showLoading) setIsLoadingPositions(true);
    setIsRefreshing(true);

    try {
      // Read leaderVault via store.getState() instead of subscribing,
      // so this callback's identity stays stable across LeaderModeSelector's
      // 10 s vault-list poll. Subscribing here would rebuild the callback
      // on every poll (setVault always writes a new object reference) and
      // re-trigger the auto-refresh effect below, which is what caused
      // the positions tab to flash its skeleton every few seconds.
      const currentLeaderVault = useLeaderModeStore.getState().vault;

      // Both flavours resolve the open-position id list from the indexer-backed
      // API (constant-time, no whole-market scan) and pull on-chain detail only
      // for that short list:
      //  - Leader mode: ids owned by the vault factory contract.
      //  - Personal mode: ids for this trader.
      let contractPositions;
      if (currentLeaderVault && factoryAddress) {
        const open = await listOpenPositions(factoryAddress).catch(() => []);
        contractPositions = await getPositionsByIds(
          publicKey,
          open.map((p) => p.positionId),
        );
      } else {
        // Personal mode: fast path via the indexer API, then fall back to the
        // full contract scan whenever the API yields NOTHING — whether it
        // errored OR returned empty. Empty-but-OK is not trusted here because
        // it also happens (a) on staging, where the shared API indexes the
        // PRODUCTION market and so never has staging-market positions, and
        // (b) in the brief window after opening before the indexer catches up.
        // Net effect: never show "no positions" when the chain has them, while
        // staying fast whenever the API does have the trader's positions. (At
        // worst this is exactly the old whole-market scan, never slower.)
        let apiPositions: Awaited<ReturnType<typeof getPositionsByIds>> = [];
        try {
          const open = await listOpenPositions(publicKey);
          apiPositions = await getPositionsByIds(
            publicKey,
            open.map((p) => p.positionId),
          );
        } catch {
          // API/indexer unavailable — fall through to the contract scan.
        }
        contractPositions =
          apiPositions.length > 0 ? apiPositions : await getPositions(publicKey);
      }

      if (contractPositions.length === 0) {
        setRawPositions([]);
        return;
      }

      // Fetch current prices for all unique assets so PnL / Mark display
      // is correct on the first paint after a refresh — the 5 s ticker
      // below keeps them fresh afterwards.
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

      setRawPositions(contractPositions);
      setCurrentPrices(prev => ({ ...prev, ...priceMap }));
    } catch (error) {
      console.error('Failed to fetch positions:', error);
    } finally {
      setIsLoadingPositions(false);
      setIsRefreshing(false);
    }
  }, [publicKey, factoryAddress]);

  // Manual refresh handler
  const handleRefreshPositions = useCallback(() => {
    fetchPositions(false); // Don't show full loading state for manual refresh
  }, [fetchPositions]);

  // Personal positions now come from the indexer-backed API, which lags a beat
  // behind a just-submitted open/close. Refetch immediately (snappy) and a
  // couple of times after so a freshly opened position appears — and a freshly
  // closed one drops — without the user hitting refresh (read-your-writes).
  const refreshPositionsAfterTrade = useCallback(() => {
    fetchPositions(false);
    [2500, 6000].forEach((ms) => window.setTimeout(() => fetchPositions(false), ms));
  }, [fetchPositions]);

  // Fetch orders function — detects status changes and shows toasts
  const fetchOrders = useCallback(async (showLoading = true) => {
    if (!publicKey) return;

    if (showLoading) setIsLoadingOrders(true);
    setIsRefreshingOrders(true);

    try {
      const contractOrders = await getOrders(publicKey);
      const displayOrders = contractOrders.map(toDisplayOrder);

      // Detect status changes for toast notifications
      const prev = prevOrdersRef.current;
      if (prev.size > 0) {
        for (const order of displayOrders) {
          const prevStatus = prev.get(order.id);
          if (prevStatus === 'Pending' && order.status !== 'Pending') {
            const label = `${order.asset} ${order.direction}`;
            if (order.status === 'Executed') {
              toast.success(`${label} order filled`);
              fetchPositions(false);
              refreshBalances();
            } else if (order.status === 'CancelledSlippage') {
              toast(`${label} order cancelled — slippage exceeded`, { icon: '⚠️' });
              refreshBalances();
            } else if (order.status === 'Cancelled') {
              toast(`${label} order cancelled`, { icon: '🔴' });
            }
          }
        }
        // Also detect orders that disappeared entirely (deleted from contract)
        for (const [id, status] of Array.from(prev.entries())) {
          if (status === 'Pending' && !displayOrders.find(o => o.id === id)) {
            toast('Order executed or removed', { icon: '⚡' });
            fetchPositions(false);
            refreshBalances();
            break;
          }
        }
      }

      // Update ref for next comparison
      const newMap = new Map<number, string>();
      for (const o of displayOrders) newMap.set(o.id, o.status);
      prevOrdersRef.current = newMap;

      setOrders(displayOrders);
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    } finally {
      setIsLoadingOrders(false);
      setIsRefreshingOrders(false);
    }
  }, [publicKey, fetchPositions, refreshBalances]);

  // Manual refresh handler for orders
  const handleRefreshOrders = useCallback(() => {
    fetchOrders(false);
  }, [fetchOrders]);

  // Auto-refresh positions and orders every 60 s when connected, plus
  // an explicit re-fetch (with skeleton) when the user actively swaps
  // leader vault. We key on `leaderVault?.id` rather than `leaderVault`
  // because LeaderModeSelector's 10 s poll writes a new VaultRow
  // reference every tick even when the data is identical — keying on
  // the id makes the effect only re-run on a real selection change.
  useEffect(() => {
    if (!isConnected || !publicKey) {
      setRawPositions([]);
      setOrders([]);
      return;
    }

    fetchPositions(true); // Initial fetch (or on vault swap) with skeleton
    fetchOrders(true);
    const interval = setInterval(() => {
      fetchPositions(false);
      fetchOrders(false);
    }, 60000); // 60 s safety tick — no skeleton
    return () => clearInterval(interval);
  }, [isConnected, publicKey, leaderVault?.id, fetchPositions, fetchOrders]);

  // Poll funding rate every 60s (updates hourly on-chain, no wallet needed)
  useEffect(() => {
    getFundingRate().then(setFundingRate);
    const interval = setInterval(() => {
      getFundingRate().then(setFundingRate);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Stable join of the unique assets in the open positions list. Used
  // as the effect dep below so the price poll only tears down + restarts
  // when the SET of assets changes — not on every rawPositions reference
  // change (a price tick that mutates currentPrices doesn't change this).
  const positionAssetKey = useMemo(
    () => Array.from(new Set(rawPositions.map(p => p.asset))).sort().join(','),
    [rawPositions],
  );

  // Live mark prices for assets in open positions. Decoupled from the
  // position-list fetch so PnL / Mark / Net Value stay live without re-running
  // the heavy N+1 contract iteration.
  //
  // Two sources: (1) one initial on-chain read via the shim for an accurate
  // starting mark, then (2) Noeracle's ~500ms SSE stream for real-time updates
  // (display only — no RPC/auth needed). Replaces the prior 5s on-chain poll, so
  // marks now refresh ~10x faster.
  useEffect(() => {
    if (!isConnected || !publicKey || !positionAssetKey) return;
    const assets = positionAssetKey.split(',');

    let cancelled = false;

    // (1) seed with an accurate on-chain mark
    (async () => {
      const updates: Record<string, number> = {};
      await Promise.all(
        assets.map(async (asset) => {
          const priceData = await getPrice(publicKey, asset);
          if (priceData) updates[asset] = priceToDisplay(priceData.price);
        }),
      );
      if (!cancelled && Object.keys(updates).length > 0) {
        setCurrentPrices(prev => ({ ...prev, ...updates }));
      }
    })();

    // (2) stream live updates (~500ms) for those assets. If the SSE feed goes
    // stale, subscribeLivePrices falls back to 5 s on-chain shim polls (fed
    // through the same callback) and reports staleness for the amber badge.
    const unsubscribe = subscribeLivePrices(
      assets,
      ({ asset, price }) => {
        if (!cancelled) {
          setCurrentPrices(prev => ({ ...prev, [asset]: price }));
        }
      },
      (stale) => {
        if (!cancelled) setPricesStale(stale);
      },
      publicKey,
    );

    return () => {
      cancelled = true;
      setPricesStale(false);
      unsubscribe();
    };
  }, [isConnected, publicKey, positionAssetKey]);

  // A10: closing — the risk-off action — gets the same toast.promise
  // lifecycle as open/SL/TP: loading state, PnL on success, decoded errors,
  // and wallet rejection made distinct from a contract revert.
  const handleClosePosition = async (positionId: number): Promise<void> => {
    if (!publicKey) throw new Error('Wallet not connected');

    const pos = positions.find(p => p.id === positionId);
    const label = pos ? `${pos.asset} ${pos.direction}` : `position #${positionId}`;

    const closePromise = (async (): Promise<bigint | null> => {
      // Leader mode: close through vault_factory so PnL settles back
      // into the vault's USDC balance, not the wallet's.
      if (leaderVault) {
        await leaderClosePosition(publicKey, walletId ?? '', leaderVault.id, positionId);
        // Pull fresh vault data so the leader-mode balance line picks
        // up the post-settlement total_usdc.
        getVault(leaderVault.id).then((v) => {
          if (v) setLeaderVault(v);
        }).catch(() => {});
        return null; // vault_factory proxy doesn't surface the PnL
      }
      if (pos?.marginMode === 'Cross') {
        const result = await closePositionCross(publicKey, sign, positionId);
        return result.pnl;
      }
      const result = await closePosition(publicKey, sign, positionId, pos?.asset ?? selectedAsset);
      return result.pnl;
    })();

    toast.promise(closePromise, {
      loading: `Closing ${label}…`,
      success: (pnl) => {
        // Refresh positions and balances. The staggered refetch covers the
        // indexer lag so the closed position drops without a manual refresh.
        refreshPositionsAfterTrade();
        refreshBalances();
        if (pnl === null) return `${label} closed`;
        const pnlUsd = fromPrecision(pnl);
        return `${label} closed — PnL ${pnlUsd >= 0 ? '+' : ''}${formatUSD(pnlUsd)}`;
      },
      error: (err) => {
        const msg = err instanceof Error ? err.message : String(err ?? '');
        if (/reject|declin|denied|cancel/i.test(msg)) return 'Transaction rejected in wallet';
        return decodeContractError(err) || 'Failed to close position';
      },
    });

    // Propagate the result so PositionsList closes its modal on success only.
    await closePromise;
  };

  const handleSetStopLoss = async (positionId: number, triggerPrice: number, slippageBps: number): Promise<void> => {
    if (!publicKey) throw new Error('Wallet not connected');

    // M-3 interim guard: SL orders attached to cross positions execute via
    // the isolated close path on-chain, corrupting the shared pool. Refuse
    // until the contract fix deploys.
    const targetPosition = positions.find(p => p.id === positionId);
    if (targetPosition?.marginMode === 'Cross') {
      toast.error('Unavailable for cross-margin positions (contract fix pending)');
      return;
    }

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
        return decodeContractError(err) || 'Failed to set stop-loss';
      },
    });

    await promise;
  };

  const handleSetTakeProfit = async (positionId: number, triggerPrice: number, slippageBps: number, limitPrice?: number): Promise<void> => {
    if (!publicKey) throw new Error('Wallet not connected');

    // M-3 interim guard — see handleSetStopLoss.
    const targetPosition = positions.find(p => p.id === positionId);
    if (targetPosition?.marginMode === 'Cross') {
      toast.error('Unavailable for cross-margin positions (contract fix pending)');
      return;
    }

    const promise = setTakeProfit(publicKey, sign, {
      positionId,
      triggerPrice: toPrecision(triggerPrice),
      slippageToleranceBps: slippageBps,
      limitPrice: limitPrice ? toPrecision(limitPrice) : undefined,
    });

    toast.promise(promise, {
      loading: 'Setting take-profit...',
      success: (order) => {
        fetchOrders(false);
        return `Take-profit set at $${triggerPrice.toFixed(2)}`;
      },
      error: (err) => {
        console.error('Failed to set take-profit:', err);
        return decodeContractError(err) || 'Failed to set take-profit';
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
        return decodeContractError(err) || 'Failed to cancel order';
      },
    });

    await promise;
  };

  // A13: "Start Trading" in the positions empty state focuses the desktop
  // OrderPanel's collateral input when it's on screen; below lg (panel
  // hidden) it opens the mobile trade sheet instead.
  const [mobileSheetRequest, setMobileSheetRequest] = useState(0);
  const handleStartTrading = useCallback(() => {
    const inputs = document.querySelectorAll<HTMLInputElement>('input[data-collateral-input]');
    const visible = Array.from(inputs).find((el) => el.offsetParent !== null);
    if (visible) {
      visible.scrollIntoView({ behavior: 'smooth', block: 'center' });
      visible.focus({ preventScroll: true });
    } else {
      setMobileSheetRequest((n) => n + 1);
    }
  }, []);

  // Count only pending orders for the badge
  const pendingOrdersCount = orders.filter(o => o.status === 'Pending').length;

  const positionTabs = [
    {
      id: 'positions',
      label: 'Positions',
      count: positions.length,
      content: (
        <>
          <CrossMarginBanner positions={positions} publicKey={publicKey ?? null} />
          <PositionsList
            positions={positions}
            isLoading={isLoadingPositions}
            isRefreshing={isRefreshing}
            onClosePosition={handleClosePosition}
            // Stop-loss / take-profit are wallet-signed market calls
            // that don't exist as vault_factory proxies. Hide them in
            // leader mode rather than render buttons that always fail.
            onSetStopLoss={leaderVault ? undefined : handleSetStopLoss}
            onSetTakeProfit={leaderVault ? undefined : handleSetTakeProfit}
            onRefresh={handleRefreshPositions}
            onStartTrading={handleStartTrading}
          />
        </>
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
          currentPrices={currentPrices}
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
                    <div className="flex items-center gap-2">
                      <AssetSelectorDropdown
                        selectedAsset={selectedAsset}
                        onSelect={setSelectedAsset}
                        markPrices={currentPrices}
                      />
                      {pricesStale && (
                        <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 whitespace-nowrap">
                          Live prices stale
                        </span>
                      )}
                    </div>
                    {/* Chart Header Stats (price, change, etc.) */}
                    <div className="hidden sm:block">
                      <ChartHeader asset={selectedAsset} compact markPrice={currentPrices[selectedAsset] || 0} />
                    </div>
                  </div>
                </div>

                {/* Timeframe Selector */}
                <div className="flex items-center gap-1 px-3 sm:px-4 py-2 border-b border-white/5 overflow-x-auto scrollbar-none">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf.value}
                      onClick={() => setSelectedTimeframe(tf.value)}
                      className={cn(
                        'px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap',
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

                {/* Price-source disclosure (A16): the candles are Binance
                    reference data; the venue executes at the Noeracle mark. */}
                <div className="px-4 py-1.5 border-t border-white/5">
                  <p className="text-[10px] text-neutral-400">
                    Chart: Binance reference · Execution: Noeracle mark
                  </p>
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

            {/* Right Sidebar - Order Panel (desktop; mobile uses the fixed bottom bar) */}
            <div className="lg:col-span-4 xl:col-span-3">
              <div className="sticky top-20 space-y-4">
                {/* OrderPanel is replaced by the fixed bottom bar below lg */}
                <div className="hidden lg:block space-y-4">
                  <LeaderModeSelector />
                  <OrderPanel
                    asset={selectedAsset}
                    markPrice={currentPrices[selectedAsset] || 0}
                    positions={positions}
                    onPositionOpened={() => {
                      refreshPositionsAfterTrade();
                      refreshBalances();
                    }}
                  />
                </div>

                {/* Market Stats */}
                <Card>
                  <h3 className="text-sm font-medium text-neutral-400 mb-4">Market Info</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-400">Open Interest</span>
                      <span className="text-white tabular-nums">
                        {assetStats
                          ? formatCompactUsd(
                              statToUsd(assetStats.openInterestLong) +
                                statToUsd(assetStats.openInterestShort),
                            )
                          : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-400">24h Volume (Noether)</span>
                      <span className="text-white tabular-nums">
                        {assetStats ? formatCompactUsd(statToUsd(assetStats.volume24h)) : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-400">
                        <Tooltip content="Positive: longs pay shorts; negative: shorts pay longs. Accrues hourly and is settled when a position closes or is liquidated.">
                          <span className="cursor-help border-b border-dotted border-neutral-600">
                            Funding / 1h
                          </span>
                        </Tooltip>{' '}
                        · settles on close
                      </span>
                      <span
                        className={cn(
                          'tabular-nums',
                          fundingRate === null
                            ? 'text-neutral-400'
                            : Number(fundingRate.toFixed(4)) === 0
                            ? 'text-white'
                            : fundingRate > 0
                            ? 'text-emerald-400'
                            : 'text-red-400',
                        )}
                      >
                        {fundingRate === null ? '—' : formatPercent(fundingRate, 4)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral-400">Max Leverage</span>
                      <span className="text-white">10x</span>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile-only trade access (fixed bottom Long/Short → bottom-sheet OrderPanel) */}
        <MobileTradeBar
          asset={selectedAsset}
          markPrice={currentPrices[selectedAsset] || 0}
          positions={positions}
          openRequest={mobileSheetRequest}
          onPositionOpened={() => {
            refreshPositionsAfterTrade();
            refreshBalances();
          }}
        />
      </main>
    </div>
  );
}

// Branded loading shell shown while the client bundle hydrates. Pure
// presentational markup — it must NOT touch useSearchParams (that's the
// hook the Suspense boundary below exists to isolate).
function TradePageSkeleton() {
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="h-16 border-b border-white/5 flex items-center px-4 lg:px-6">
        <div className="h-5 w-28 rounded bg-[#eab308]/20 animate-pulse" />
      </div>
      <main>
        <div className="max-w-[1800px] mx-auto p-4 lg:p-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
            <div className="hidden xl:block xl:col-span-2 space-y-4">
              <div className="h-[44vh] rounded-lg border border-white/10 bg-white/[0.03] animate-pulse" />
              <div className="h-[44vh] rounded-lg border border-white/10 bg-white/[0.03] animate-pulse" />
            </div>
            <div className="lg:col-span-8 xl:col-span-7 space-y-4">
              <div className="h-[400px] lg:h-[500px] rounded-lg border border-white/10 bg-white/[0.03] animate-pulse" />
              <div className="h-64 rounded-lg border border-white/10 bg-white/[0.03] animate-pulse" />
            </div>
            <div className="lg:col-span-4 xl:col-span-3">
              <div className="h-[500px] rounded-lg border border-[#eab308]/15 bg-white/[0.03] animate-pulse" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// A34: TradePage consumes useSearchParams(), which without a Suspense
// boundary forces the whole route into the __next_error__ CSR shell
// (blank first paint + auto-injected noindex). The boundary keeps the
// static shell server-renderable.
export default function TradePageWrapper() {
  return (
    <Suspense fallback={<TradePageSkeleton />}>
      <TradePage />
    </Suspense>
  );
}
