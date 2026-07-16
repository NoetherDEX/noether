'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { Tabs } from '@/components/ui';
import { Header } from '@/components/layout';
import { WalletProvider } from '@/components/wallet';
import {
  TradingChart,
  OrderPanel,
  PositionsList,
  OrdersList,
  TradeHistoryContainer,
  RecentTrades,
  OrderBook,
  OraclePriceCard,
  CrossMarginBanner,
  MobileTradeBar,
  MarketStatsBar,
  TradingViewChart,
} from '@/components/trading';
import { LeaderModeSelector } from '@/components/trading/LeaderModeSelector';
import { FirstSessionChecklist } from '@/components/trading/FirstSessionChecklist';
import type { ChartType } from '@/components/trading/TradingChart';
import type { CandleSource } from '@/lib/api/candles';
import { useLeaderModeStore } from '@/lib/store';
import { leaderClosePosition } from '@/lib/stellar/vaultFactory';
import { getVault, getVaultTrades } from '@/lib/api/vaults';
import { useSearchParams, useRouter } from 'next/navigation';
import { useWallet } from '@/lib/hooks/useWallet';
import { TIMEFRAMES, NULL_ACCOUNT } from '@/lib/utils/constants';
import { cn } from '@/lib/utils/cn';
import {
  getPositions,
  getPositionsByIds,
  toDisplayPosition,
  closePosition,
  closePositionCross,
  getOrders,
  getOrdersByIds,
  toDisplayOrder,
  setStopLoss,
  setTakeProfit,
  cancelOrder,
  getFundingRate,
  getCumulativeFundingRate,
  getRecentLiquidations,
} from '@/lib/stellar/market';
import { listOpenPositions } from '@/lib/api/positions';
import { listOrderHints } from '@/lib/api/orders';
import { gatewayServesThisMarket } from '@/lib/api/gateway';
import { getMarketsStats, type AssetMarketStats } from '@/lib/api/markets';
import { getPrice, priceToDisplay } from '@/lib/stellar/oracle';
import { subscribeLivePrices } from '@/lib/stellar/noeracle';
import { toPrecision, fromPrecision } from '@/lib/utils';
import { formatUSD } from '@/lib/utils/format';
import { decodeContractError } from '@/lib/utils/contractErrors';
import type { Position, DisplayPosition, DisplayOrder } from '@/types';
import toast from 'react-hot-toast';

function TradePage() {
  const [selectedAsset, setSelectedAsset] = useState('BTC');
  const [selectedTimeframe, setSelectedTimeframe] = useState('1h');
  const [chartType, setChartType] = useState<ChartType>('candles');
  const [chartSource, setChartSource] = useState<CandleSource>('binance');
  // Raw contract positions. Refreshed on connect / vault-swap / explicit
  // trade actions / 60 s safety tick — NOT on every price update. The
  // displayed PnL / Mark / Net Value comes from currentPrices below.
  const [rawPositions, setRawPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<DisplayOrder[]>([]);
  // True when the LAST refresh failed — rows keep their last-good values and
  // a strip explains staleness instead of wiping into "No open positions".
  const [positionsFetchFailed, setPositionsFetchFailed] = useState(false);
  const [ordersFetchFailed, setOrdersFetchFailed] = useState(false);
  // Monotonic sequence guards: overlapping refreshes (the 0/2.5/6s post-trade
  // burst vs the 60s tick) must never let a STALE response overwrite newer
  // state — that race could resurrect a just-closed position.
  const positionsFetchSeq = useRef(0);
  const ordersFetchSeq = useRef(0);
  // B1 liquidation vanish-detection: id → isCross of the last applied poll,
  // plus ids the user just closed themselves (never toast those as liqs).
  const prevPositionIdsRef = useRef<Map<number, boolean> | null>(null);
  const expectedCloseIdsRef = useRef<Set<number>>(new Set());
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRefreshingOrders, setIsRefreshingOrders] = useState(false);
  // null = unknown (RPC failure / entry absent) — rendered as '—', never a
  // healthy-looking +0.0000% (A14).
  const [fundingRate, setFundingRate] = useState<number | null>(null);
  // Global cumulative funding index (PRECISION-scaled) — null until first read.
  const [cumulativeFunding, setCumulativeFunding] = useState<bigint | null>(null);
  // B10: last signed attestation per asset (ts + round) from the SSE stream —
  // powers the oracle-transparency card's live-ticking age.
  const [lastAttestations, setLastAttestations] = useState<Record<string, { ts: number; roundId: number }>>({});
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});
  const [pricesStale, setPricesStale] = useState(false);
  const [assetStats, setAssetStats] = useState<AssetMarketStats | null>(null);
  const prevOrdersRef = useRef<Map<number, string>>(new Map());

  // Display positions are derived from raw positions + the latest prices,
  // so a price tick re-renders just the PnL / Mark / Net Value cells
  // (React reconciliation handles the in-place text update) without
  // re-fetching the whole position list from the contract.
  const positions = useMemo<DisplayPosition[]>(
    () => rawPositions.map(p => toDisplayPosition(p, currentPrices[p.asset] || 0, cumulativeFunding)),
    [rawPositions, currentPrices, cumulativeFunding],
  );

  const { isConnected, publicKey, walletId, sign, refreshBalances, xlmBalance, usdcBalance } = useWallet();
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

  // B1: when a position disappears between polls WITHOUT a user-initiated
  // close, check recent on-chain liquidation events and tell the trader —
  // margin seized with no record is the worst trust failure a venue can ship.
  const detectLiquidatedVanish = useCallback(async (current: Map<number, boolean>) => {
    const prev = prevPositionIdsRef.current;
    prevPositionIdsRef.current = current;
    if (!prev || !publicKey) return;

    const vanished = Array.from(prev.keys()).filter(
      (id) => !current.has(id) && !expectedCloseIdsRef.current.has(id)
    );
    // Consume expected closes that have now landed on-chain.
    for (const id of Array.from(expectedCloseIdsRef.current)) {
      if (!current.has(id)) expectedCloseIdsRef.current.delete(id);
    }
    if (vanished.length === 0) return;

    try {
      const liqs = await getRecentLiquidations(publicKey);
      if (liqs.length === 0) return; // order fill / external close — already toasted elsewhere
      const isolated = new Map(
        liqs.filter((l) => l.positionId != null).map((l) => [l.positionId as number, l])
      );
      const crossLiq = liqs.find((l) => l.positionId === null) ?? null;
      let crossToasted = false;
      for (const id of vanished) {
        const hit = isolated.get(id);
        if (hit) {
          toast.error(`Position #${id} liquidated at ${formatUSD(hit.price)}`, {
            duration: 12000,
          });
        } else if (crossLiq && prev.get(id) === true && !crossToasted) {
          crossToasted = true;
          const pnlText =
            crossLiq.totalPnl != null ? ` — total PnL ${formatUSD(crossLiq.totalPnl)}` : '';
          toast.error(`Cross-margin account liquidated${pnlText}`, { duration: 12000 });
        }
      }
    } catch {
      // Best-effort: no toast is better than a wrong toast.
    }
  }, [publicKey]);

  // Fetch positions function - extracted for manual refresh
  const fetchPositions = useCallback(async (showLoading = true) => {
    if (!publicKey) return;

    const seq = ++positionsFetchSeq.current;
    const isStale = () => seq !== positionsFetchSeq.current;

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
        // No .catch(() => []) here: an API outage must surface as a failed
        // refresh (rows kept + strip), not as a fake empty vault book.
        //
        // B18 (P0 UI-half): the factory owns EVERY vault's positions — a
        // leader with two vaults used to see (and could close) the other
        // vault's positions as their own. Scope the id list to THIS vault
        // via its indexed leader_open/leader_close trades; if the scoping
        // read fails we THROW (kept-last-good + strip) rather than fall
        // back to the unscoped cross-vault list. The contract-side
        // membership check is C1.
        const [open, vaultTrades] = await Promise.all([
          listOpenPositions(factoryAddress),
          getVaultTrades(currentLeaderVault.id, 200),
        ]);
        const opened = new Set<string>();
        const closed = new Set<string>();
        for (const t of vaultTrades) {
          if (t.action === 'open') opened.add(String(t.positionId));
          else closed.add(String(t.positionId));
        }
        const thisVaultIds = new Set(
          Array.from(opened).filter((id) => !closed.has(id)),
        );
        contractPositions = await getPositionsByIds(
          publicKey,
          open
            .map((p) => p.positionId)
            .filter((id) => thisVaultIds.has(String(id))),
        );
      } else {
        // Personal mode: fast path via the indexer API. An API ERROR still
        // falls back to the full contract scan, but a successful EMPTY
        // response is now trusted when gatewayServesThisMarket() confirms the
        // gateway (a) resolves THIS build's market contract and (b) has a
        // fresh indexer cursor. The guard is what makes trusting "empty"
        // safe: on staging the shared gateway indexes the PRODUCTION market
        // (address mismatch → never trusted → old scan behavior), and a
        // stalled indexer demotes the gateway within a minute. The brief
        // post-trade indexer lag is covered by refreshPositionsAfterTrade's
        // 0/2.5s/6s burst. Without this, a wallet with ZERO positions always
        // paid the worst path: a sequential scan of every position id on the
        // market just to render "No open positions".
        let apiPositions: Awaited<ReturnType<typeof getPositionsByIds>> | null = null;
        try {
          const open = await listOpenPositions(publicKey);
          if (open.length === 0) {
            apiPositions = (await gatewayServesThisMarket()) ? [] : null;
          } else {
            const hydrated = await getPositionsByIds(
              publicKey,
              open.map((p) => p.positionId),
            );
            // Every hinted id failed to resolve on-chain (all closed this
            // instant, or the RPC dropped the reads) — stay defensive: rescan.
            apiPositions = hydrated.length > 0 ? hydrated : null;
          }
        } catch {
          // API/indexer unavailable — fall through to the contract scan.
        }
        contractPositions = apiPositions ?? (await getPositions(publicKey));
      }

      if (isStale()) return;

      if (contractPositions.length === 0) {
        // Genuinely empty (failed reads THROW and land in the catch below).
        setRawPositions([]);
        setPositionsFetchFailed(false);
        if (!currentLeaderVault) void detectLiquidatedVanish(new Map());
        else prevPositionIdsRef.current = null;
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

      if (isStale()) return;
      setRawPositions(contractPositions);
      setCurrentPrices(prev => ({ ...prev, ...priceMap }));
      setPositionsFetchFailed(false);
      if (!currentLeaderVault) {
        void detectLiquidatedVanish(
          new Map(contractPositions.map((p) => [p.id, p.marginMode === 'Cross']))
        );
      } else {
        prevPositionIdsRef.current = null;
      }
    } catch (error) {
      console.error('Failed to fetch positions:', error);
      // Keep last-good rows; the strip above the tables explains staleness.
      if (!isStale()) setPositionsFetchFailed(true);
    } finally {
      if (!isStale()) {
        setIsLoadingPositions(false);
        setIsRefreshing(false);
      }
    }
  }, [publicKey, factoryAddress, detectLiquidatedVanish]);

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

    const seq = ++ordersFetchSeq.current;
    const isStale = () => seq !== ordersFetchSeq.current;

    if (showLoading) setIsLoadingOrders(true);
    setIsRefreshingOrders(true);

    try {
      // Fast path: id-hints from /v1/orders/open (status=all keeps the
      // executed/cancelled history rows), hydrated per-id on-chain — replaces
      // getOrders' get_all_order_ids + EVERY-market-order sequential scan.
      // Same trust rules as positions: hints only count when the gateway
      // serves THIS market with a fresh cursor; an API error, a mismatched
      // market, or a suspicious hydration miss falls back to the legacy scan.
      let contractOrders: Awaited<ReturnType<typeof getOrders>> | null = null;
      if (await gatewayServesThisMarket()) {
        try {
          const hints = await listOrderHints({ trader: publicKey, status: 'all', limit: 200 });
          if (hints.length === 0) {
            contractOrders = [];
          } else {
            const hydrated = await getOrdersByIds(publicKey, hints.map((h) => h.orderId));
            // Hydration coming back empty is legitimate when every hinted
            // order is already resolved (executed/cancelled orders get pruned
            // from contract storage) — but with an 'open' hint outstanding it
            // smells like dropped RPC reads, so rescan.
            const hasOpenHint = hints.some((h) => h.status === 'open');
            contractOrders = hydrated.length > 0 || !hasOpenHint ? hydrated : null;
          }
        } catch {
          contractOrders = null; // gateway hiccup — legacy scan below
        }
      }
      if (contractOrders === null) {
        contractOrders = await getOrders(publicKey);
      }
      if (isStale()) return;
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
      setOrdersFetchFailed(false);
    } catch (error) {
      console.error('Failed to fetch orders:', error);
      // Keep last-good rows — a failed read is not "no orders".
      if (!isStale()) setOrdersFetchFailed(true);
    } finally {
      if (!isStale()) {
        setIsLoadingOrders(false);
        setIsRefreshingOrders(false);
      }
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
      setPositionsFetchFailed(false);
      setOrdersFetchFailed(false);
      prevPositionIdsRef.current = null;
      expectedCloseIdsRef.current.clear();
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

  // Poll funding rate + the cumulative index every 60s (updates hourly
  // on-chain, no wallet needed). The index feeds the per-position accrued
  // funding estimate (B4). Keep last-good on failed refreshes.
  useEffect(() => {
    const load = () => {
      getFundingRate().then(setFundingRate);
      getCumulativeFundingRate().then((v) => {
        if (v != null) setCumulativeFunding(v);
      });
    };
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  // Stable join of the unique assets in the open positions list. Used
  // as the effect dep below so the price poll only tears down + restarts
  // when the SET of assets changes — not on every rawPositions reference
  // change (a price tick that mutates currentPrices doesn't change this).
  const positionAssetKey = useMemo(() => {
    const set = new Set(rawPositions.map(p => p.asset));
    // B3: ALWAYS stream the selected market too. Before, the venue's own
    // oracle price only flowed for assets with open positions — first-trade
    // users priced entries and liq previews off the Binance fallback and the
    // staleness badge could never fire for them.
    set.add(selectedAsset);
    return Array.from(set).sort().join(',');
  }, [rawPositions, selectedAsset]);

  // Live mark prices for assets in open positions. Decoupled from the
  // position-list fetch so PnL / Mark / Net Value stay live without re-running
  // the heavy N+1 contract iteration.
  //
  // Two sources: (1) one initial on-chain read via the shim for an accurate
  // starting mark, then (2) Noeracle's ~500ms SSE stream for real-time updates
  // (display only — no RPC/auth needed). Replaces the prior 5s on-chain poll, so
  // marks now refresh ~10x faster.
  useEffect(() => {
    // No wallet gate: the SSE stream and the shim read both work with the
    // read-only null account — every visitor sees the execution price (B3).
    if (!positionAssetKey) return;
    const assets = positionAssetKey.split(',');
    const readerKey = publicKey ?? NULL_ACCOUNT;

    let cancelled = false;

    // (1) seed with an accurate on-chain mark
    (async () => {
      const updates: Record<string, number> = {};
      await Promise.all(
        assets.map(async (asset) => {
          const priceData = await getPrice(readerKey, asset);
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
      ({ asset, price, timestamp, roundId }) => {
        if (!cancelled) {
          setCurrentPrices(prev => ({ ...prev, [asset]: price }));
          setLastAttestations(prev => ({ ...prev, [asset]: { ts: timestamp, roundId } }));
        }
      },
      (stale) => {
        if (!cancelled) setPricesStale(stale);
      },
      readerKey,
    );

    return () => {
      cancelled = true;
      setPricesStale(false);
      unsubscribe();
    };
  }, [publicKey, positionAssetKey]);

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
        // User-initiated close — never toast this vanish as a liquidation.
        expectedCloseIdsRef.current.add(positionId);
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

  // Chart mode: 'pro' embeds the full TradingView chart (indicators, drawing
  // tools); 'basic' is the native chart that carries the Noeracle mark and
  // position/order overlays. Persisted like the dock preference.
  const [chartMode, setChartMode] = useState<'pro' | 'basic'>('pro');
  useEffect(() => {
    try {
      if (localStorage.getItem('noether:chart-mode') === 'basic') setChartMode('basic');
    } catch {}
  }, []);
  const setMode = useCallback((mode: 'pro' | 'basic') => {
    setChartMode(mode);
    try {
      localStorage.setItem('noether:chart-mode', mode);
    } catch {}
  }, []);

  // Layout preference: dock the Positions/Orders tables under the chart so
  // both share one screen (lg+); default keeps the full-width bottom section.
  const [dockTables, setDockTables] = useState(false);
  useEffect(() => {
    try {
      setDockTables(localStorage.getItem('noether:trade-dock') === '1');
    } catch {}
  }, []);
  const toggleDock = useCallback(() => {
    setDockTables((d) => {
      try {
        localStorage.setItem('noether:trade-dock', d ? '0' : '1');
      } catch {}
      return !d;
    });
  }, []);

  // Count only pending orders for the badge
  const pendingOrdersCount = orders.filter(o => o.status === 'Pending').length;

  // Bottom tab selection lives in the URL (?tab=) so views deep-link and
  // survive refresh (REDESIGN.md acceptance criteria). Invalid values fall
  // back to Positions.
  const TAB_IDS = ['positions', 'orders', 'history', 'orderbook', 'trades'] as const;
  const tabParam = searchParams?.get('tab');
  const initialTab = TAB_IDS.includes(tabParam as (typeof TAB_IDS)[number])
    ? (tabParam as string)
    : 'positions';
  const handleTabChange = useCallback(
    (tabId: string) => {
      const params = new URLSearchParams(searchParams?.toString());
      if (tabId === 'positions') params.delete('tab');
      else params.set('tab', tabId);
      const qs = params.toString();
      router.replace(qs ? `/trade?${qs}` : '/trade', { scroll: false });
    },
    [searchParams, router],
  );

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
            orders={orders}
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
    // Real venue data (pending limit orders / indexer fills) — lived in the
    // old left sidebar; now reachable as tabs so the chart keeps the width.
    {
      // B10: never present a book-shaped panel of the venue's own resting
      // orders as an "Order Book" — Noether is oracle-priced (no CLOB), and
      // the courted audience reads a fake book as a ghost town or a lie.
      id: 'orderbook',
      label: 'Open Orders',
      content: (
        <div className="max-w-2xl">
          {/* B10: oracle transparency instead of a fake book */}
          <OraclePriceCard
            asset={selectedAsset}
            markPrice={currentPrices[selectedAsset] || 0}
            attestation={lastAttestations[selectedAsset] ?? null}
            fundingRate={fundingRate}
            stale={pricesStale}
          />
          <p className="mb-3 text-[11px] text-faint">
            Noether fills at the oracle price — there is no order book. These
            are the venue&apos;s resting limit/trigger orders awaiting execution.
          </p>
          <OrderBook asset={selectedAsset} />
        </div>
      ),
    },
    {
      id: 'trades',
      label: 'Recent Trades',
      content: (
        <div className="max-w-2xl">
          <RecentTrades />
        </div>
      ),
    },
  ];

  // Failed-refresh strip: rows below keep their last-good values; this makes
  // the staleness visible instead of letting an RPC outage cosplay as an
  // empty account.
  const fetchFailStrip = (positionsFetchFailed || ordersFetchFailed) ? (
    <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-primary">
      <span>
        Couldn&apos;t refresh{' '}
        {positionsFetchFailed && ordersFetchFailed
          ? 'positions & orders'
          : positionsFetchFailed
          ? 'positions'
          : 'orders'}{' '}
        — showing last known data. Retries every 60s.
      </span>
      <button
        onClick={() => {
          if (positionsFetchFailed) fetchPositions(false);
          if (ordersFetchFailed) fetchOrders(false);
        }}
        className="underline hover:opacity-80 flex-none"
      >
        Retry now
      </button>
    </div>
  ) : null;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="pt-12">
        {/* B29: money pages need a page title for screen readers — the visual
            hierarchy starts at the stats bar, so it's visually hidden. */}
        <h1 className="sr-only">Trade {selectedAsset}-PERP — Noether</h1>
        {/* Thin market-stats strip: pair selector · mark · 24h stats · OI · funding */}
        <MarketStatsBar
          selectedAsset={selectedAsset}
          onSelect={setSelectedAsset}
          markPrices={currentPrices}
          fundingRate={fundingRate}
          assetStats={assetStats}
          pricesStale={pricesStale}
        />

        {/* Chart (dominant, left) + 320px order rail (right) */}
        <div className="lg:flex lg:items-stretch">
          <div className="flex-1 min-w-0 flex flex-col lg:border-r lg:border-border">
            {/* Timeframe + chart-mode toolbar */}
            <div className="flex items-center justify-between gap-2 px-2 sm:px-3 py-1 border-b border-border">
              <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-none">
                {chartMode === 'basic' ? (
                  TIMEFRAMES.map((tf) => (
                    <button
                      key={tf.value}
                      onClick={() => setSelectedTimeframe(tf.value)}
                      className={cn(
                        'px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap',
                        selectedTimeframe === tf.value
                          ? 'bg-surface-2 text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {tf.label}
                    </button>
                  ))
                ) : (
                  <span className="px-2.5 py-1.5 text-[11px] text-faint whitespace-nowrap">
                    Indicators & drawing tools in the chart toolbar
                  </span>
                )}
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                {/* Pro (TradingView) vs Basic (native, with mark/position overlays) */}
                <div className="flex items-center bg-surface-2 rounded-md p-0.5 gap-0.5 mr-1">
                  {(['pro', 'basic'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      aria-pressed={chartMode === m}
                      title={m === 'pro' ? 'Full chart — indicators & drawings' : 'Basic chart — mark price & position overlays'}
                      className={cn(
                        'px-2 py-1 text-xs font-medium rounded-[4px] capitalize transition-colors',
                        chartMode === m
                          ? 'bg-surface-3 text-foreground'
                          : 'text-faint hover:text-foreground'
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                {chartMode === 'basic' &&
                  (['candles', 'line', 'area'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setChartType(t)}
                      aria-pressed={chartType === t}
                      title={t === 'candles' ? 'Candlesticks' : t === 'line' ? 'Line' : 'Area'}
                      className={cn(
                        'px-2 py-1.5 text-xs font-medium rounded-md capitalize transition-colors',
                        chartType === t
                          ? 'bg-surface-2 text-foreground'
                          : 'text-faint hover:text-foreground'
                      )}
                    >
                      {t}
                    </button>
                  ))}
                <span className="hidden lg:block w-px h-4 bg-border mx-1" aria-hidden="true" />
                <button
                  onClick={toggleDock}
                  aria-pressed={dockTables}
                  title={dockTables ? 'Move tables below the fold' : 'Dock tables under the chart'}
                  aria-label={dockTables ? 'Move tables below the fold' : 'Dock tables under the chart'}
                  className={cn(
                    'hidden lg:inline-flex items-center px-2 py-1.5 rounded-md transition-colors',
                    dockTables ? 'bg-surface-2 text-foreground' : 'text-faint hover:text-foreground'
                  )}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke="currentColor" />
                    <line x1="1.5" y1="10.5" x2="14.5" y2="10.5" stroke="currentColor" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Chart — fills whatever height the row has (the order rail sets
                it on lg), so no dead band can open between axis and footer */}
            <div className="flex-1 h-[380px] lg:h-auto lg:min-h-[440px]">
              {chartMode === 'pro' ? (
                <TradingViewChart asset={selectedAsset} interval={selectedTimeframe} />
              ) : (
                <TradingChart
                  asset={selectedAsset}
                  interval={selectedTimeframe}
                  chartType={chartType}
                  markPrice={currentPrices[selectedAsset] || 0}
                  stale={pricesStale}
                  positions={positions.filter((p) => p.asset === selectedAsset)}
                  orders={orders.filter((o) => o.asset === selectedAsset && o.status === 'Pending')}
                  onSource={setChartSource}
                />
              )}
            </div>

            {/* Price-source disclosure (A16): native Noeracle candles when
                the venue has them, else Binance reference. Execution is
                always the Noeracle mark. */}
            <div className="px-3 py-1.5 border-t border-border">
              <p className="text-[10px] text-faint">
                {chartMode === 'pro'
                  ? 'Chart: TradingView (Binance feed) · Execution: Noeracle mark'
                  : chartSource === 'noeracle'
                  ? 'Chart: Noether candles (Noeracle) · Execution: Noeracle mark'
                  : 'Chart: Binance reference · Execution: Noeracle mark'}
              </p>
            </div>

            {/* Docked mode: tables live right under the chart, same screen */}
            {dockTables && (
              <div className="border-t border-border px-3 pb-4 lg:h-[360px] lg:flex-none lg:overflow-y-auto custom-scrollbar">
                {fetchFailStrip}
                <Tabs tabs={positionTabs} defaultTab={initialTab} onChange={handleTabChange} />
              </div>
            )}
          </div>

          {/* Order rail — desktop only; mobile trades via the fixed bottom bar */}
          <aside className="hidden lg:block w-[320px] shrink-0">
            {/* B22: guided first-session funnel — disappears once traded */}
            <FirstSessionChecklist
              isConnected={isConnected}
              xlmBalance={xlmBalance}
              usdcBalance={usdcBalance}
              hasTraded={positions.length > 0 || orders.length > 0}
            />
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
          </aside>
        </div>

        {/* Positions / Orders / History / venue activity — full-width */}
        {!dockTables && (
          <div className="border-t border-border px-3 sm:px-4 pb-8">
            {fetchFailStrip}
            <Tabs tabs={positionTabs} defaultTab={initialTab} onChange={handleTabChange} />
          </div>
        )}

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
    <div className="min-h-screen bg-background">
      <div className="h-12 border-b border-border flex items-center px-4">
        <div className="h-4 w-28 rounded-sm bg-surface-3 animate-pulse" />
      </div>
      <main>
        <div className="h-14 border-b border-border flex items-center gap-4 px-4">
          <div className="h-6 w-40 rounded-sm bg-surface-3 animate-pulse" />
          <div className="h-6 w-64 rounded-sm bg-surface-2 animate-pulse hidden sm:block" />
        </div>
        <div className="lg:flex">
          <div className="flex-1 min-w-0 lg:border-r lg:border-border">
            <div className="h-[380px] lg:h-[calc(100dvh-21rem)] lg:min-h-[440px] bg-surface animate-pulse" />
          </div>
          <div className="hidden lg:block w-[320px] shrink-0 p-4 space-y-3">
            <div className="h-9 rounded-md bg-surface-3 animate-pulse" />
            <div className="h-64 rounded-md bg-surface-2 animate-pulse" />
          </div>
        </div>
        <div className="border-t border-border p-4">
          <div className="h-40 rounded-md bg-surface animate-pulse" />
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
