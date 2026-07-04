'use client';

import { useState, useEffect, useMemo } from 'react';
import { AlertCircle, Info, Loader2, AlertTriangle, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { useWallet } from '@/lib/hooks/useWallet';
import { useTradeStore, useLeaderModeStore } from '@/lib/store';
import { fetchTicker } from '@/lib/hooks/usePriceData';
import { openPosition, openPositionCross, placeLimitOrder, placeStopLimitOrder, placeTrailingStop, getCrossMarginBalance, depositCrossMargin, withdrawCrossMargin, getTraderFeeInfo, setStopLoss, setTakeProfit } from '@/lib/stellar/market';
import { leaderOpenPosition } from '@/lib/stellar/vaultFactory';
import { getVault } from '@/lib/api/vaults';
import { VAULT_PRECISION } from '@/types/vault';
import {
  formatUSD,
  formatNumber,
  calculateLiquidationPrice,
  toPrecision,
} from '@/lib/utils';
import { cn } from '@/lib/utils/cn';
import { decodeContractError } from '@/lib/utils/contractErrors';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { TRADING, FEE_TIERS } from '@/lib/utils/constants';
import type { TriggerCondition, DisplayPosition } from '@/types';

interface OrderPanelProps {
  asset: string;
  positions?: DisplayPosition[];
  onSubmit?: () => void;
  onPositionOpened?: () => void;
  /**
   * Live Noeracle mark price (USD) for `asset`, streamed by the parent trade
   * page (~500ms SSE). This is the price the contract actually triggers and
   * liquidates against, so it — not Binance — is the reference shown for
   * trigger prices and the liquidation preview. Falls back to the Binance
   * ticker only until the first Noeracle frame arrives.
   */
  markPrice?: number;
}

export function OrderPanel({ asset, positions = [], onSubmit, onPositionOpened, markPrice = 0 }: OrderPanelProps) {
  const { isConnected, publicKey, walletId, xlmBalance, usdcBalance, sign, refreshBalances } = useWallet();
  const { vault: leaderVault, setVault: setLeaderVault } = useLeaderModeStore();
  const isLeader = !!leaderVault;
  // Leader mode trades from the vault's USDC pool, not the wallet's.
  const vaultBalanceUsdc = leaderVault
    ? Number(BigInt(leaderVault.totalUsdc)) / Number(VAULT_PRECISION)
    : 0;
  const effectiveUsdcBalance = isLeader ? vaultBalanceUsdc : usdcBalance;
  const {
    direction,
    collateral,
    leverage,
    setDirection,
    setCollateral,
    setLeverage,
  } = useTradeStore();

  // Order type state
  const [orderType, setOrderType] = useState<'Market' | 'Limit' | 'StopLimit' | 'TrailingStop'>('Market');

  // Margin mode
  const [marginMode, setMarginMode] = useState<'Isolated' | 'Cross'>('Isolated');

  // Leader mode lacks vault_factory proxies for Cross / Limit / StopLimit /
  // TrailingStop, so silently snap back to the supported flavour whenever
  // the leader switches in (the UI itself hides those controls below).
  useEffect(() => {
    if (!isLeader) return;
    if (marginMode !== 'Isolated') setMarginMode('Isolated');
    if (orderType !== 'Market') setOrderType('Market');
  }, [isLeader, marginMode, orderType]);
  const [crossBalance, setCrossBalance] = useState<number>(0);
  const [crossDepositAmount, setCrossDepositAmount] = useState<string>('');
  const [crossWithdrawAmount, setCrossWithdrawAmount] = useState<string>('');
  const [isCrossDepositing, setIsCrossDepositing] = useState(false);
  const [isCrossWithdrawing, setIsCrossWithdrawing] = useState(false);

  // Price states.
  // `assetPrice` is the reference price shown for trigger prices and the
  // liquidation preview. It MUST match what the contract executes against —
  // the live Noeracle mark price (`markPrice`, streamed by the parent). The
  // Binance ticker below is only a bootstrap fallback until the first
  // Noeracle frame arrives.
  const [fallbackPrice, setFallbackPrice] = useState<number>(0);
  const hasMarkPrice = markPrice > 0;
  const assetPrice = hasMarkPrice ? markPrice : fallbackPrice;

  // Limit order states
  const [triggerPrice, setTriggerPrice] = useState<string>('');
  const [slippageTolerance, setSlippageTolerance] = useState<number>(50);
  const [customSlippage, setCustomSlippage] = useState<string>('');

  // Optional TP/SL attached at open (P4-17). Isolated + Market only — the
  // contract rejects SL/TP on cross-margin (#80). Pipelined as follow-up
  // signatures after the open confirms (interim; a single-signature
  // router path is a later contract change).
  const [attachSl, setAttachSl] = useState<string>('');
  const [attachTp, setAttachTp] = useState<string>('');
  const canAttachTpSl = orderType === 'Market' && marginMode === 'Isolated' && !isLeader;

  // Stop Limit states
  const [stopPrice, setStopPrice] = useState<string>('');
  const [limitPrice, setLimitPrice] = useState<string>('');

  // Trailing Stop states
  const [trailingPercent, setTrailingPercent] = useState<string>('3');
  const [trailingPositionId, setTrailingPositionId] = useState<string>('');

  // Time-in-Force & Reduce Only states
  const [timeInForce, setTimeInForce] = useState<number>(0); // 0=GTC, 1=IOC, 2=PostOnly
  const [reduceOnly, setReduceOnly] = useState<boolean>(false);

  // Fee tier info — existing 14d volume fetched from contract
  const [existing14dVolume, setExisting14dVolume] = useState<number>(0);

  // M-3 interim guard: trailing stops attached to cross positions execute via
  // the isolated close path on-chain, corrupting the shared pool. Only offer
  // isolated positions until the contract fix deploys.
  const trailingEligiblePositions = positions.filter(p => p.marginMode !== 'Cross');
  const hasCrossPositions = positions.length > trailingEligiblePositions.length;

  // UI states
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch a Binance fallback price ONLY while the Noeracle mark price is
  // unavailable (e.g. before the first SSE frame). Once `markPrice` is live we
  // stop polling — the contract triggers/liquidates against Noeracle, not
  // Binance, so the panel should quote the same source as execution.
  useEffect(() => {
    if (hasMarkPrice) return;
    let cancelled = false;
    const loadPrice = async () => {
      try {
        const ticker = await fetchTicker(asset);
        if (!cancelled) setFallbackPrice(ticker.price);
      }
      catch (error) {
        console.error('Failed to fetch fallback price:', error);
      }
    };

    loadPrice();
    const interval = setInterval(loadPrice, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [asset, hasMarkPrice]);

  // Fetch existing 14d volume and cross-margin balance
  useEffect(() => {
    if (!publicKey) return;
    const load = async () => {
      try {
        const info = await getTraderFeeInfo(publicKey);
        if (info) {
          setExisting14dVolume(Number(info.volume14d) / 10_000_000);
        }
      } catch {}
      try {
        const bal = await getCrossMarginBalance(publicKey);
        setCrossBalance(Number(bal) / 10_000_000);
      } catch {}
    };
    load();
  }, [publicKey]);

  // Calculate derived values
  const collateralNum = parseFloat(collateral) || 0;

  // Position size in USD (collateral is already in USD since it's USDC)
  const positionSize = collateralNum * leverage;

  const liquidationPrice = useMemo(
    () =>
      assetPrice > 0
        ? calculateLiquidationPrice(assetPrice, leverage, direction === 'Long')
        : 0,
    [assetPrice, leverage, direction]
  );

  const isMaker = orderType === 'Limit' || orderType === 'StopLimit';

  // Dynamically compute fee tier based on projected volume (existing + this trade)
  const projectedFee = useMemo(() => {
    const projectedVolume = existing14dVolume + positionSize;
    let tierIndex = 0;
    for (let i = FEE_TIERS.length - 1; i >= 0; i--) {
      if (projectedVolume >= FEE_TIERS[i].minVolume) {
        tierIndex = i;
        break;
      }
    }
    const tier = FEE_TIERS[tierIndex];
    const nextTier = tierIndex < FEE_TIERS.length - 1 ? FEE_TIERS[tierIndex + 1] : null;
    const feeBps = isMaker ? tier.makerBps : tier.takerBps;
    const feeAmount = positionSize * feeBps / 100000;
    const volStr = projectedVolume >= 1_000_000
      ? `$${(projectedVolume / 1_000_000).toFixed(2)}M`
      : `$${projectedVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    const nextVolStr = nextTier
      ? (nextTier.minVolume >= 1_000_000 ? `$${(nextTier.minVolume / 1_000_000).toFixed(0)}M` : `$${nextTier.minVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
      : '';
    return {
      tierName: tier.name,
      feeBps,
      feeAmount,
      volume14d: volStr,
      nextTierName: nextTier?.name ?? 'Max',
      nextTierVolume: nextVolStr,
    };
  }, [existing14dVolume, positionSize, isMaker]);

  const feeBps = projectedFee.feeBps;
  const tradingFee = projectedFee.feeAmount;

  // Risk assessment based on leverage
  const liquidationRisk = leverage >= 8 ? 'high' : leverage >= 5 ? 'medium' : 'low';

  // Validation
  const errors: string[] = [];
  if (orderType === 'TrailingStop') {
    if (!trailingPositionId) errors.push('Select a position');
    if (positions.find(p => p.id === Number(trailingPositionId))?.marginMode === 'Cross')
      errors.push('Unavailable for cross-margin positions (contract fix pending)');
    if (xlmBalance < 1) errors.push('Need XLM for gas fees');
  } else {
    if (collateralNum > 0 && collateralNum < 10) errors.push('Minimum collateral is 10 USDC');
    if (collateralNum > effectiveUsdcBalance)
      errors.push(isLeader ? 'Vault balance too low' : 'Insufficient USDC balance');
    if (positionSize > 100000) errors.push('Position size exceeds $100,000 maximum');
    if (xlmBalance < 1) errors.push('Need XLM for gas fees');
    if (isLeader && marginMode === 'Cross')
      errors.push('Leader trades support isolated margin only');
    if (isLeader && orderType !== 'Market')
      errors.push('Leader trades support market orders only');
    if (orderType === 'Limit') {
      if (slippageTolerance <= 0 || slippageTolerance > 10000) errors.push('Slippage must be between 0.01% and 100%');
      const triggerPriceNum = parseFloat(triggerPrice) || 0;
      if (triggerPriceNum <= 0) errors.push('Enter a valid trigger price');
    }
    if (orderType === 'StopLimit') {
      if (!(parseFloat(stopPrice) > 0)) errors.push('Enter stop price');
      if (!(parseFloat(limitPrice) > 0)) errors.push('Enter limit price');
    }
  }

  const canSubmit = isConnected && errors.length === 0 &&
    (orderType === 'TrailingStop' ? !!trailingPositionId : collateralNum >= 10);

  // Attach optional TP/SL to a freshly-opened isolated position as separate
  // follow-up signatures (P4-17). Best-effort: the position is already open,
  // so a rejected/cancelled attach just surfaces a toast and leaves the
  // position without that order — it never unwinds the open.
  const attachTpSlAfterOpen = async (positionId: number | undefined) => {
    if (!positionId || !publicKey || !canAttachTpSl) return;
    const slNum = parseFloat(attachSl) || 0;
    const tpNum = parseFloat(attachTp) || 0;

    if (slNum > 0) {
      try {
        await toast.promise(
          setStopLoss(publicKey, sign, {
            positionId,
            triggerPrice: toPrecision(slNum),
            slippageToleranceBps: slippageTolerance,
          }),
          {
            loading: 'Attaching stop-loss…',
            success: 'Stop-loss attached',
            error: (err) => decodeContractError(err) || 'Stop-loss not attached',
          },
        );
      } catch { /* toast surfaced it; position stays open */ }
    }

    if (tpNum > 0) {
      try {
        await toast.promise(
          setTakeProfit(publicKey, sign, {
            positionId,
            triggerPrice: toPrecision(tpNum),
            slippageToleranceBps: slippageTolerance,
          }),
          {
            loading: 'Attaching take-profit…',
            success: 'Take-profit attached',
            error: (err) => decodeContractError(err) || 'Take-profit not attached',
          },
        );
      } catch { /* toast surfaced it; position stays open */ }
    }

    setAttachSl('');
    setAttachTp('');
  };

  // Handle position submission (market or limit)
  const handleSubmit = async () => {
    if (!canSubmit || !publicKey) return;

    setIsSubmitting(true);

    if (orderType === 'TrailingStop') {
      // Trailing stop - attach to existing position
      const posId = parseInt(trailingPositionId) || 0;
      // M-3 interim guard — cross positions must never reach place_trailing_stop.
      if (positions.find(p => p.id === posId)?.marginMode === 'Cross') {
        toast.error('Unavailable for cross-margin positions (contract fix pending)');
        setIsSubmitting(false);
        return;
      }
      const pct = Math.round((parseFloat(trailingPercent) || 3) * 100); // % to bps
      try {
        await placeTrailingStop(publicKey, sign, {
          positionId: posId,
          trailingPercentBps: pct,
          slippageToleranceBps: slippageTolerance,
        });
        toast.success(`Trailing stop (${trailingPercent}%) placed on position #${posId}`);
        onSubmit?.();
      } catch (err: any) {
        toast.error(decodeContractError(err) || 'Failed to place trailing stop');
      }
      setIsSubmitting(false);
      return;
    }

    if (orderType === 'StopLimit') {
      // Stop-limit order
      const stopPriceNum = parseFloat(stopPrice) || 0;
      const limitPriceNum = parseFloat(limitPrice) || 0;
      const triggerAbove = direction === 'Short';
      try {
        const encodedTif = timeInForce | (reduceOnly ? 0x100 : 0);
        await placeStopLimitOrder(publicKey, sign, {
          asset,
          direction,
          collateral: toPrecision(collateralNum),
          leverage,
          triggerPrice: toPrecision(stopPriceNum),
          limitPrice: toPrecision(limitPriceNum),
          triggerAbove,
          slippageToleranceBps: slippageTolerance,
          timeInForce: encodedTif,
        });
        toast.success(`Stop-limit order placed! Stop: $${stopPriceNum}, Limit: $${limitPriceNum}`);
        setCollateral('');
        setStopPrice('');
        setLimitPrice('');
        refreshBalances();
        onSubmit?.();
      } catch (err: any) {
        toast.error(decodeContractError(err) || 'Failed to place stop-limit order');
      }
      setIsSubmitting(false);
      return;
    }

    if (orderType === 'Market') {
      // Leader mode: route the order through vault_factory so the
      // vault's USDC backs the position, not the wallet's.
      if (isLeader && leaderVault) {
        const leaderPromise = leaderOpenPosition(publicKey, walletId ?? '', {
          vaultId: leaderVault.id,
          asset,
          collateral: toPrecision(collateralNum),
          leverage,
          direction,
        });
        toast.promise(leaderPromise, {
          loading: `Opening ${direction} ${asset} as leader of ${leaderVault.name}…`,
          success: () => {
            setCollateral('');
            onSubmit?.();
            // Soroban RPC needs a moment for the new position to be
            // queryable via simulateTransaction. Without this delay the
            // positions list refresh fires before the state has
            // propagated and the new row never shows up.
            setTimeout(() => onPositionOpened?.(), 2000);
            // Refresh vault data so the balance line and the
            // selector reflect the post-trade pool size.
            getVault(leaderVault.id).then((fresh) => {
              if (fresh) setLeaderVault(fresh);
            }).catch(() => {});
            return `${direction} ${asset} opened from ${leaderVault.name}`;
          },
          error: (err) => decodeContractError(err) || 'Leader trade failed',
        });
        try { await leaderPromise; } catch {}
        setIsSubmitting(false);
        return;
      }
      // Market order - immediate execution
      if (marginMode === 'Cross') {
        // Cross-margin: single tx - contract auto-deposits from wallet if pool insufficient
        const openCrossPromise = openPositionCross(publicKey, sign, {
          asset,
          collateral: toPrecision(collateralNum),
          leverage,
          direction,
        });

        toast.promise(openCrossPromise, {
          loading: `Opening Cross ${direction} ${asset}...`,
          success: () => {
            setExisting14dVolume(prev => prev + positionSize);
            setCollateral('');
            refreshBalances();
            onSubmit?.();
            onPositionOpened?.();
            getCrossMarginBalance(publicKey).then(b => setCrossBalance(Number(b) / 10_000_000)).catch(() => {});
            return `Cross ${direction} ${asset} position opened!`;
          },
          error: (err) => decodeContractError(err) || 'Failed to open cross position',
        });

        try { await openCrossPromise; } catch {}
      } else {
        // Isolated margin - direct open
        const openPositionPromise = openPosition(publicKey, sign, {
          asset,
          collateral: toPrecision(collateralNum),
          leverage,
          direction,
        });

        toast.promise(openPositionPromise, {
          loading: `Opening ${direction} ${asset} position...`,
          success: (position) => {
            setExisting14dVolume(prev => prev + positionSize);
            setCollateral('');
            refreshBalances();
            onSubmit?.();
            onPositionOpened?.();
            return `${direction} ${asset} position opened!`;
          },
          error: (err) => {
            console.error('Failed to open position:', err);
            if (err?.message?.includes('InsufficientCollateral')) {
              return 'Insufficient collateral. Minimum is 10 USDC.';
            }
            if (err?.message?.includes('InvalidLeverage')) {
              return 'Invalid leverage. Must be between 1x and 10x.';
            }
            return decodeContractError(err) || 'Failed to open position';
          },
        });

        try {
          const opened = await openPositionPromise;
          // Pipeline optional TP/SL as follow-up signatures once the open
          // has confirmed and we know the position id (P4-17).
          await attachTpSlAfterOpen(opened?.id);
        } catch {
          // Error handled by toast
        }
      }
    } else {
      // Limit order - conditional execution
      const triggerPriceNum = parseFloat(triggerPrice) || 0;
      const triggerPricePrecision = toPrecision(triggerPriceNum);

      // Determine trigger condition based on direction and price
      // Long: buy when price goes BELOW trigger (dip buy)
      // Short: sell when price goes ABOVE trigger (rally short)
      const triggerCondition: TriggerCondition =
        direction === 'Long' ? 'Below' : 'Above';

      // Encode time_in_force: bits 0-7 = TIF mode, bit 8 = reduce_only
      const encodedTif = timeInForce | (reduceOnly ? 0x100 : 0);

      const placeLimitOrderPromise = placeLimitOrder(publicKey, sign, {
        asset,
        direction,
        collateral: toPrecision(collateralNum),
        leverage,
        triggerPrice: triggerPricePrecision,
        triggerCondition,
        slippageToleranceBps: slippageTolerance,
        timeInForce: encodedTif,
      });

      toast.promise(placeLimitOrderPromise, {
        loading: `Placing ${direction} limit order...`,
        success: (order) => {
          setCollateral('');
          setTriggerPrice('');
          refreshBalances();
          onSubmit?.();
          return `Limit order placed! ID: ${order.id}. Will execute when ${asset} reaches $${triggerPriceNum.toFixed(2)}`;
        },
        error: (err) => {
          console.error('Failed to place limit order:', err);
          if (err?.message?.includes('InvalidTriggerPrice')) {
            return 'Invalid trigger price. Please check your entry.';
          }
          if (err?.message?.includes('InvalidSlippageTolerance')) {
            return 'Invalid slippage tolerance.';
          }
          return decodeContractError(err) || 'Failed to place limit order';
        },
      });

      try {
        await placeLimitOrderPromise;
      } catch {
        // Error handled by toast
      }
    }

    setIsSubmitting(false);
  };

  // Percentage buttons for collateral — uses the active source (wallet or vault)
  const handlePercentage = (pct: number) => {
    setCollateral(Math.floor(effectiveUsdcBalance * (pct / 100)).toString());
  };

  // Cross-margin deposit handler
  const handleCrossDeposit = async () => {
    if (!publicKey || isCrossDepositing) return;
    const amount = parseFloat(crossDepositAmount) || 0;
    if (amount < 1) { toast.error('Minimum deposit is 1 USDC'); return; }
    if (amount > usdcBalance) { toast.error('Insufficient USDC balance'); return; }

    setIsCrossDepositing(true);
    try {
      await depositCrossMargin(publicKey, sign, toPrecision(amount));
      toast.success(`Deposited ${amount} USDC to cross-margin pool`);
      setCrossDepositAmount('');
      refreshBalances();
      const bal = await getCrossMarginBalance(publicKey);
      setCrossBalance(Number(bal) / 10_000_000);
    } catch (err: any) {
      toast.error(decodeContractError(err) || 'Failed to deposit');
    } finally {
      setIsCrossDepositing(false);
    }
  };

  // Cross-margin withdraw handler
  const handleCrossWithdraw = async () => {
    if (!publicKey || isCrossWithdrawing) return;
    const amount = parseFloat(crossWithdrawAmount) || 0;
    if (amount < 1) { toast.error('Minimum withdrawal is 1 USDC'); return; }
    if (amount > crossBalance) { toast.error('Exceeds pool balance'); return; }

    setIsCrossWithdrawing(true);
    try {
      await withdrawCrossMargin(publicKey, sign, toPrecision(amount));
      toast.success(`Withdrew ${amount} USDC from cross-margin pool`);
      setCrossWithdrawAmount('');
      refreshBalances();
      const bal = await getCrossMarginBalance(publicKey);
      setCrossBalance(Number(bal) / 10_000_000);
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('CrossMarginInsufficientFreeMargin')) {
        toast.error('Insufficient free margin — reduce positions first');
      } else {
        toast.error(decodeContractError(err) || 'Failed to withdraw');
      }
    } finally {
      setIsCrossWithdrawing(false);
    }
  };

  return (
    <div className="h-full rounded-lg border border-white/10 bg-[#0a0a0a] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">Place Order</h3>
        {isLeader && (
          <button
            type="button"
            onClick={() => setLeaderVault(null)}
            className="text-[10px] uppercase tracking-wider text-amber-400 hover:text-amber-300 transition-colors"
          >
            Exit leader mode
          </button>
        )}
      </div>

      {isLeader && leaderVault && (
        <div className="px-4 py-2.5 border-b border-amber-500/20 bg-amber-500/[0.06] flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-amber-400/80">
              Leader mode
            </div>
            <div className="text-xs text-amber-200 truncate">
              Trading <span className="font-medium">{leaderVault.name}</span> · vault balance{' '}
              <span className="font-mono">{formatNumber(vaultBalanceUsdc)} USDC</span>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Margin Mode Toggle — Cross has no vault_factory proxy yet,
            so the whole toggle is hidden in leader mode. */}
        {!isLeader && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMarginMode('Isolated')}
              className={cn(
                'flex-1 py-1.5 text-xs font-medium rounded border transition-all',
                marginMode === 'Isolated'
                  ? 'bg-primary/20 border-primary/50 text-primary'
                  : 'border-white/10 text-muted-foreground hover:text-foreground'
              )}
            >
              Isolated
            </button>
            <button
              onClick={() => setMarginMode('Cross')}
              className={cn(
                'flex-1 py-1.5 text-xs font-medium rounded border transition-all',
                marginMode === 'Cross'
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-500'
                  : 'border-white/10 text-muted-foreground hover:text-foreground'
              )}
            >
              Cross
            </button>
          </div>
        )}

        {/* Cross-Margin Info + Deposit/Withdraw */}
        {!isLeader && marginMode === 'Cross' && (
          <div className="space-y-2">
            <div className="p-2 bg-amber-500/10 rounded border border-amber-500/20">
              <div className="flex justify-between text-xs">
                <span className="text-amber-500">Cross Margin</span>
                <span className="text-amber-500/70">Positions share collateral</span>
              </div>
              <div className="flex justify-between text-xs mt-1">
                <span className="text-muted-foreground">Pool Balance</span>
                <span className="font-mono text-foreground">{formatNumber(crossBalance)} USDC</span>
              </div>
            </div>

            {/* Deposit/Withdraw Controls */}
            {isConnected && (
              <div className="p-2 bg-zinc-900/50 rounded border border-white/10 space-y-2">
                {/* Deposit */}
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={crossDepositAmount}
                      onChange={(e) => setCrossDepositAmount(e.target.value)}
                      placeholder="Deposit USDC"
                      className="w-full bg-zinc-900/80 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50"
                    />
                  </div>
                  <button
                    onClick={handleCrossDeposit}
                    disabled={isCrossDepositing || !crossDepositAmount}
                    className="px-3 py-1.5 text-xs font-medium rounded bg-amber-500/20 text-amber-500 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    {isCrossDepositing ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Deposit'}
                  </button>
                </div>
                {/* Withdraw */}
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={crossWithdrawAmount}
                      onChange={(e) => setCrossWithdrawAmount(e.target.value)}
                      placeholder="Withdraw USDC"
                      className="w-full bg-zinc-900/80 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50"
                    />
                  </div>
                  <button
                    onClick={handleCrossWithdraw}
                    disabled={isCrossWithdrawing || !crossWithdrawAmount}
                    className="px-3 py-1.5 text-xs font-medium rounded bg-zinc-800 text-foreground border border-white/10 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    {isCrossWithdrawing ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Withdraw'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Order Type Tabs — leader mode only has the market proxy.
            Limit / StopLimit / TrailingStop don't exist on vault_factory
            so they're elided from the strip entirely instead of being
            clickable-but-broken. */}
        <div
          className={cn(
            'gap-0 rounded-lg overflow-hidden border border-white/10',
            isLeader ? 'grid grid-cols-1' : 'grid grid-cols-4',
          )}
        >
          {(isLeader
            ? (['Market'] as const)
            : (['Market', 'Limit', 'StopLimit', 'TrailingStop'] as const)
          ).map((type) => (
            <button
              key={type}
              onClick={() => setOrderType(type)}
              className={cn(
                'py-2 text-[11px] font-medium transition-all',
                orderType === type
                  ? 'bg-primary/20 text-primary border-b-2 border-primary'
                  : 'bg-secondary/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              )}
            >
              {type === 'StopLimit' ? 'Stop Limit' : type === 'TrailingStop' ? 'Trail Stop' : type}
            </button>
          ))}
        </div>

        {/* Long/Short Tabs - hidden for TrailingStop (uses position's direction) */}
        {orderType !== 'TrailingStop' && <div className="grid grid-cols-2 gap-0 rounded-lg overflow-hidden border border-white/10">
          <button
            onClick={() => setDirection('Long')}
            className={cn(
              'py-3 text-sm font-bold transition-all relative',
              direction === 'Long'
                ? 'bg-[#22c55e] text-white'
                : 'bg-secondary/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            )}
          >
            Long
            {direction === 'Long' && <div className="absolute inset-0 bg-[#22c55e]/20 animate-pulse" />}
          </button>
          <button
            onClick={() => setDirection('Short')}
            className={cn(
              'py-3 text-sm font-bold transition-all relative',
              direction === 'Short'
                ? 'bg-[#ef4444] text-white'
                : 'bg-secondary/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            )}
          >
            Short
            {direction === 'Short' && <div className="absolute inset-0 bg-[#ef4444]/20 animate-pulse" />}
          </button>
        </div>}

        {/* Pay (Collateral) Input - hidden for TrailingStop */}
        {orderType !== 'TrailingStop' && <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground flex items-center gap-1.5">
              Pay (Collateral)
              <Info className="h-3 w-3 opacity-50" />
            </label>
          </div>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={collateral}
              onChange={(e) => setCollateral(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0.00"
              className="w-full bg-zinc-900/50 border border-white/10 rounded-md px-3 py-3 text-right font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors pr-20"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              <TokenIcon symbol="USDC" size={16} />
              <span className="text-xs font-medium text-foreground">USDC</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {isLeader ? 'Vault balance' : 'Balance'}:{' '}
              <span className="font-mono text-foreground">
                {formatNumber(effectiveUsdcBalance)}
              </span>{' '}
              USDC
            </span>
          </div>
          {/* Percentage Buttons */}
          <div className="grid grid-cols-4 gap-1.5">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                onClick={() => handlePercentage(pct)}
                className="py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-secondary/30 hover:bg-secondary/60 rounded border border-white/5 hover:border-white/10 transition-all"
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>}

        {/* Leverage Slider - hidden for TrailingStop */}
        {orderType !== 'TrailingStop' && <div className="space-y-3 p-3 bg-secondary/20 rounded-lg border border-white/5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground flex items-center gap-1.5">
              Leverage
              <Info className="h-3 w-3 opacity-50" />
            </label>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'text-lg font-mono font-bold',
                  leverage >= 8 ? 'text-[#ef4444]' : leverage >= 5 ? 'text-[#f59e0b]' : 'text-foreground'
                )}
              >
                {leverage}x
              </span>
            </div>
          </div>

          <div className="relative pt-1">
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={leverage}
              onChange={(e) => setLeverage(parseInt(e.target.value))}
              className="w-full h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>

          {/* Quick leverage buttons */}
          <div className="grid grid-cols-5 gap-1.5">
            {[1, 2, 5, 8, 10].map((lev) => (
              <button
                key={lev}
                onClick={() => setLeverage(lev)}
                className={cn(
                  'py-1.5 text-xs font-mono font-medium rounded border transition-all',
                  leverage === lev
                    ? 'bg-primary/20 border-primary/50 text-primary'
                    : 'border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20'
                )}
              >
                {lev}x
              </button>
            ))}
          </div>
        </div>}

        {/* Limit Order Settings (only show when Limit is selected) */}
        {orderType === 'Limit' && (
          <div className="space-y-3 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
            <h4 className="text-xs font-medium text-amber-500 uppercase tracking-wider">
              Limit Order Settings
            </h4>

            {/* Trigger Price */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  Trigger Price
                  <Info className="h-3 w-3 opacity-50" />
                </label>
                <span className="text-xs text-muted-foreground">
                  Current: ${assetPrice.toFixed(asset === 'XLM' ? 4 : 2)}
                </span>
              </div>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={triggerPrice}
                  onChange={(e) => setTriggerPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="Enter the trigger price"
                  className="w-full bg-zinc-900/50 border border-white/10 rounded-md px-3 py-2.5 text-right font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 transition-colors pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {direction === 'Long'
                  ? 'Order triggers when price drops to this level'
                  : 'Order triggers when price rises to this level'}
              </p>
            </div>

            {/* Slippage Tolerance */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  Slippage Tolerance
                  <Info className="h-3 w-3 opacity-50" />
                </label>
                <span className="text-xs font-mono text-foreground">
                  {(slippageTolerance / 100).toFixed(2)}%
                </span>
              </div>
              <div className="flex gap-1.5">
                {/* Preset buttons */}
                {[50, 100, 200].map((bps) => (
                  <button
                    key={bps}
                    onClick={() => {
                      setSlippageTolerance(bps);
                      setCustomSlippage('');
                    }}
                    className={cn(
                      'flex-1 py-1.5 text-xs font-medium rounded border transition-all',
                      slippageTolerance === bps && customSlippage === ''
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-500'
                        : 'border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20'
                    )}
                  >
                    {(bps / 100).toFixed(1)}%
                  </button>
                ))}
                {/* Custom input */}
                <div className="relative flex-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={customSlippage}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '');
                      setCustomSlippage(val);
                      const parsed = parseFloat(val);
                      if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
                        setSlippageTolerance(Math.round(parsed * 100)); // Convert % to bps
                      }
                    }}
                    placeholder="Custom"
                    className={cn(
                      'w-full bg-zinc-900/50 border rounded-md px-2 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 transition-colors pr-5',
                      customSlippage !== ''
                        ? 'border-amber-500/50'
                        : 'border-white/10'
                    )}
                  />
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">%</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Order cancelled if execution price differs by more than this (default: 0.5%)
              </p>
            </div>

            {/* Time-in-Force */}
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                Time-in-Force
                <Info className="h-3 w-3 opacity-50" />
              </label>
              <div className="flex gap-1.5">
                {([
                  { value: 0, label: 'GTC' },
                  { value: 1, label: 'IOC' },
                  { value: 2, label: 'Post Only' },
                ] as const).map((tif) => (
                  <button
                    key={tif.value}
                    onClick={() => setTimeInForce(tif.value)}
                    className={cn(
                      'flex-1 py-1.5 text-xs font-medium rounded border transition-all',
                      timeInForce === tif.value
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-500'
                        : 'border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20'
                    )}
                  >
                    {tif.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {timeInForce === 0
                  ? 'Good Till Cancel — order stays open until filled or cancelled'
                  : timeInForce === 1
                  ? 'Immediate Or Cancel — fills now or cancels instantly'
                  : 'Post Only — rejected if it would fill immediately (maker only)'}
              </p>
            </div>

            {/* Reduce Only */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={reduceOnly}
                onChange={(e) => setReduceOnly(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-white/20 bg-zinc-900/50 text-amber-500 focus:ring-amber-500 focus:ring-offset-0"
              />
              <span className="text-xs text-muted-foreground">
                Reduce Only
              </span>
              <Info className="h-3 w-3 opacity-50 text-muted-foreground" />
            </label>
            {reduceOnly && (
              <p className="text-xs text-muted-foreground -mt-1 ml-5">
                Order will only execute if it reduces an existing position
              </p>
            )}
          </div>
        )}

        {/* Stop Limit Settings */}
        {orderType === 'StopLimit' && (
          <div className="space-y-3 p-3 bg-purple-500/10 rounded-lg border border-purple-500/20">
            <h4 className="text-xs font-medium text-purple-400 uppercase tracking-wider">
              Stop Limit
            </h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <label className="text-xs text-muted-foreground">Stop Price</label>
                <span className="text-[10px] text-purple-400/60">Activates the order</span>
              </div>
              <input
                type="text"
                inputMode="decimal"
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder={`e.g. ${assetPrice > 0 ? (assetPrice * 0.95).toFixed(2) : '0'}`}
                className="w-full bg-zinc-900/50 border border-white/10 rounded-md px-3 py-2 text-right font-mono text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <label className="text-xs text-muted-foreground">Limit Price</label>
                <span className="text-[10px] text-purple-400/60">Max entry price</span>
              </div>
              <input
                type="text"
                inputMode="decimal"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder={`e.g. ${assetPrice > 0 ? (assetPrice * 0.94).toFixed(2) : '0'}`}
                className="w-full bg-zinc-900/50 border border-white/10 rounded-md px-3 py-2 text-right font-mono text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {direction === 'Long'
                ? 'When price drops to stop, a buy limit at your limit price activates.'
                : 'When price rises to stop, a sell limit at your limit price activates.'}
            </p>
          </div>
        )}

        {/* Trailing Stop Settings */}
        {orderType === 'TrailingStop' && (
          <div className="space-y-3 p-3 bg-cyan-500/10 rounded-lg border border-cyan-500/20">
            <h4 className="text-xs font-medium text-cyan-400 uppercase tracking-wider">
              Trailing Stop
            </h4>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Select Position</label>
              {trailingEligiblePositions.length > 0 ? (
                <select
                  value={trailingPositionId}
                  onChange={(e) => setTrailingPositionId(e.target.value)}
                  className="w-full bg-zinc-900/50 border border-white/10 rounded-md px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="">Select a position...</option>
                  {trailingEligiblePositions.map((pos) => (
                    <option key={pos.id} value={pos.id.toString()}>
                      #{pos.id} {pos.asset} {pos.direction} {pos.leverage}x — ${pos.size.toLocaleString(undefined, {maximumFractionDigits: 0})}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-muted-foreground py-2">No open positions. Open a position first.</p>
              )}
              {hasCrossPositions && (
                <p className="text-xs text-muted-foreground/70">
                  Unavailable for cross-margin positions (contract fix pending)
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Trailing %</label>
              <div className="flex gap-1.5">
                {['1', '2', '3', '5'].map((pct) => (
                  <button
                    key={pct}
                    onClick={() => setTrailingPercent(pct)}
                    className={cn(
                      'flex-1 py-1.5 text-xs font-mono rounded border transition-all',
                      trailingPercent === pct
                        ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400'
                        : 'border-white/10 text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {pct}%
                  </button>
                ))}
                <input
                  type="text"
                  inputMode="decimal"
                  value={trailingPercent}
                  onChange={(e) => setTrailingPercent(e.target.value.replace(/[^0-9.]/g, ''))}
                  className="w-16 bg-zinc-900/50 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-right focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Stop follows peak price. Triggers when price drops {trailingPercent || '?'}% from peak.
            </p>
          </div>
        )}

        {/* Optional TP/SL at open (P4-17) — isolated Market orders only */}
        {canAttachTpSl && (
          <div className="space-y-2.5 p-3 bg-secondary/20 rounded-lg border border-white/5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Take Profit / Stop Loss
              </h4>
              <span className="text-[10px] text-muted-foreground">optional</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] text-emerald-400/70">Take Profit</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={attachTp}
                  onChange={(e) => setAttachTp(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder={assetPrice > 0 ? (assetPrice * (direction === 'Long' ? 1.1 : 0.9)).toFixed(2) : '0'}
                  className="w-full bg-zinc-900/50 border border-white/10 rounded-md px-3 py-2 text-right font-mono text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-red-400/70">Stop Loss</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={attachSl}
                  onChange={(e) => setAttachSl(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder={assetPrice > 0 ? (assetPrice * (direction === 'Long' ? 0.95 : 1.05)).toFixed(2) : '0'}
                  className="w-full bg-zinc-900/50 border border-white/10 rounded-md px-3 py-2 text-right font-mono text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Attached as separate signatures right after the position opens.
            </p>
          </div>
        )}

        {/* Order Summary Box */}
        <div className="space-y-2.5 p-3 bg-secondary/20 rounded-lg border border-white/5">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Order Summary</h4>

          <div className="space-y-2">
            {/* Position Size */}
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">Position Size</span>
              <span className="font-mono text-sm text-foreground">{formatUSD(positionSize)}</span>
            </div>

            {/* Entry Price / Trigger Price */}
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                {orderType === 'Limit' ? 'Trigger Price' : 'Entry Price'}
              </span>
              <span className="font-mono text-sm text-foreground">
                {orderType === 'Limit'
                  ? triggerPrice
                    ? formatUSD(parseFloat(triggerPrice), asset === 'XLM' ? 4 : 2)
                    : '--'
                  : assetPrice > 0
                  ? formatUSD(assetPrice, asset === 'XLM' ? 4 : 2)
                  : '--'}
              </span>
            </div>

            {/* Liquidation Price */}
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                Liq. Price
                {liquidationRisk === 'high' && <AlertTriangle className="h-3 w-3 text-[#ef4444]" />}
              </span>
              <span
                className={cn(
                  'font-mono text-sm font-medium',
                  liquidationRisk === 'high'
                    ? 'text-[#ef4444]'
                    : liquidationRisk === 'medium'
                    ? 'text-[#f59e0b]'
                    : 'text-foreground'
                )}
              >
                {liquidationPrice > 0 ? formatUSD(liquidationPrice, asset === 'XLM' ? 4 : 2) : '--'}
              </span>
            </div>

            {/* Divider */}
            <div className="border-t border-white/5 my-1" />

            {/* Trading Fee */}
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">
                Fee ({isMaker ? 'Maker' : 'Taker'} {(feeBps / 1000).toFixed(3)}%)
              </span>
              <span className="font-mono text-xs text-muted-foreground">{formatUSD(tradingFee)}</span>
            </div>

            {/* Fee Tier Info */}
            {positionSize > 0 && (
              <>
                <div className="border-t border-white/5 my-1" />
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Fee Tier</span>
                  <span className="font-mono text-xs text-primary">{projectedFee.tierName}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">14d Volume</span>
                  <span className="font-mono text-xs text-muted-foreground">{projectedFee.volume14d}</span>
                </div>
                {projectedFee.nextTierVolume && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Next: {projectedFee.nextTierName}</span>
                    <span className="font-mono text-xs text-muted-foreground">{projectedFee.nextTierVolume}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Errors */}
        {errors.length > 0 && collateralNum > 0 && (
          <div className="p-3 bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-lg">
            {errors.map((error, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-[#ef4444]">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            ))}
          </div>
        )}

        {/* CTA Button */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || isSubmitting}
          className={cn(
            'w-full h-14 text-base font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed',
            'flex items-center justify-center gap-2 rounded-lg',
            direction === 'Long'
              ? 'bg-[#22c55e] hover:bg-[#22c55e]/90 text-white'
              : 'bg-[#ef4444] hover:bg-[#ef4444]/90 text-white'
          )}
        >
          {isSubmitting && <Loader2 className="w-5 h-5 animate-spin" />}
          {!isConnected
            ? 'Connect Wallet'
            : orderType === 'Limit'
            ? `Place ${direction} Limit Order`
            : orderType === 'StopLimit'
            ? `Place ${direction} Stop Limit`
            : orderType === 'TrailingStop'
            ? 'Place Trailing Stop'
            : `${direction === 'Long' ? 'Buy / Long' : 'Sell / Short'} ${asset}${marginMode === 'Cross' ? ' (Cross)' : ''}`}
        </button>
      </div>
    </div>
  );
}
