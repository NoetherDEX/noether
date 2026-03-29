'use client';

import { useState, useEffect, useMemo } from 'react';
import { AlertCircle, Info, Loader2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useWallet } from '@/lib/hooks/useWallet';
import { useTradeStore } from '@/lib/store';
import { fetchTicker } from '@/lib/hooks/usePriceData';
import { openPosition, openPositionCross, placeLimitOrder, placeStopLimitOrder, placeTrailingStop, depositCrossMargin, withdrawCrossMargin, getCrossMarginBalance, getTraderFeeInfo } from '@/lib/stellar/market';
import {
  formatUSD,
  formatNumber,
  calculateLiquidationPrice,
  toPrecision,
} from '@/lib/utils';
import { cn } from '@/lib/utils/cn';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { TRADING } from '@/lib/utils/constants';
import type { TriggerCondition } from '@/types';

interface OrderPanelProps {
  asset: string;
  onSubmit?: () => void;
  onPositionOpened?: () => void;
}

export function OrderPanel({ asset, onSubmit, onPositionOpened }: OrderPanelProps) {
  const { isConnected, publicKey, xlmBalance, usdcBalance, sign, refreshBalances } = useWallet();
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
  const [crossBalance, setCrossBalance] = useState<number>(0);
  const [crossDepositAmount, setCrossDepositAmount] = useState<string>('');
  const [showCrossDeposit, setShowCrossDeposit] = useState(false);

  // Price states
  const [assetPrice, setAssetPrice] = useState<number>(0);

  // Limit order states
  const [triggerPrice, setTriggerPrice] = useState<string>('');
  const [slippageTolerance, setSlippageTolerance] = useState<number>(50);
  const [customSlippage, setCustomSlippage] = useState<string>('');

  // Stop Limit states
  const [stopPrice, setStopPrice] = useState<string>('');
  const [limitPrice, setLimitPrice] = useState<string>('');

  // Trailing Stop states
  const [trailingPercent, setTrailingPercent] = useState<string>('3');
  const [trailingPositionId, setTrailingPositionId] = useState<string>('');

  // Fee tier info
  const [makerFeeBps, setMakerFeeBps] = useState<number>(TRADING.BASE_MAKER_FEE_BPS);
  const [takerFeeBps, setTakerFeeBps] = useState<number>(TRADING.BASE_TAKER_FEE_BPS);

  // UI states
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch asset price
  useEffect(() => {
    const loadPrice = async () => {
      try {
        const ticker = await fetchTicker(asset);
        setAssetPrice(ticker.price);
      }
      catch (error) {
        console.error('Failed to fetch price:', error);
      }
    };

    loadPrice();
    const interval = setInterval(loadPrice, 5000);
    return () => clearInterval(interval);
  }, [asset]);

  // Fetch fee tier info and cross-margin balance
  useEffect(() => {
    if (!publicKey) return;
    const loadFeeInfo = async () => {
      try {
        const info = await getTraderFeeInfo(publicKey);
        if (info) {
          setMakerFeeBps(info.makerFeeBps);
          setTakerFeeBps(info.takerFeeBps);
        }
      } catch {}
      try {
        const bal = await getCrossMarginBalance(publicKey);
        setCrossBalance(Number(bal) / 10_000_000);
      } catch {}
    };
    loadFeeInfo();
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
  const feeBps = isMaker ? makerFeeBps : takerFeeBps;
  const tradingFee = positionSize * feeBps / 10000;

  // Risk assessment based on leverage
  const liquidationRisk = leverage >= 8 ? 'high' : leverage >= 5 ? 'medium' : 'low';

  // Validation
  const errors: string[] = [];
  if (collateralNum > 0 && collateralNum < 10) errors.push('Minimum collateral is 10 USDC');
  if (orderType !== 'TrailingStop') {
    if (collateralNum > usdcBalance) errors.push('Insufficient USDC balance');
  }
  if (positionSize > 100000) errors.push('Position size exceeds $100,000 maximum');
  if (xlmBalance < 1) errors.push('Need XLM for gas fees');
  if (orderType === 'Limit') {
    if (slippageTolerance <= 0 || slippageTolerance > 10000) errors.push('Slippage must be between 0.01% and 100%');
    const triggerPriceNum = parseFloat(triggerPrice) || 0;
    if (triggerPriceNum <= 0) errors.push('Enter a valid trigger price');
  }

  const canSubmit = isConnected && collateralNum >= 10 && errors.length === 0;

  // Handle cross-margin deposit
  const handleCrossDeposit = async () => {
    if (!publicKey) return;
    const amount = parseFloat(crossDepositAmount) || 0;
    if (amount <= 0) return;
    setIsSubmitting(true);
    try {
      await depositCrossMargin(publicKey, sign, toPrecision(amount));
      toast.success(`Deposited ${amount} USDC to cross-margin pool`);
      setCrossDepositAmount('');
      setShowCrossDeposit(false);
      refreshBalances();
      const bal = await getCrossMarginBalance(publicKey);
      setCrossBalance(Number(bal) / 10_000_000);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to deposit');
    }
    setIsSubmitting(false);
  };

  // Handle position submission (market or limit)
  const handleSubmit = async () => {
    if (!canSubmit || !publicKey) return;

    setIsSubmitting(true);

    if (orderType === 'TrailingStop') {
      // Trailing stop - attach to existing position
      const posId = parseInt(trailingPositionId) || 0;
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
        toast.error(err?.message || 'Failed to place trailing stop');
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
        await placeStopLimitOrder(publicKey, sign, {
          asset,
          direction,
          collateral: toPrecision(collateralNum),
          leverage,
          triggerPrice: toPrecision(stopPriceNum),
          limitPrice: toPrecision(limitPriceNum),
          triggerAbove,
          slippageToleranceBps: slippageTolerance,
        });
        toast.success(`Stop-limit order placed! Stop: $${stopPriceNum}, Limit: $${limitPriceNum}`);
        setCollateral('');
        setStopPrice('');
        setLimitPrice('');
        refreshBalances();
        onSubmit?.();
      } catch (err: any) {
        toast.error(err?.message || 'Failed to place stop-limit order');
      }
      setIsSubmitting(false);
      return;
    }

    if (orderType === 'Market') {
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
            setCollateral('');
            refreshBalances();
            onSubmit?.();
            onPositionOpened?.();
            getCrossMarginBalance(publicKey).then(b => setCrossBalance(Number(b) / 10_000_000)).catch(() => {});
            return `Cross ${direction} ${asset} position opened!`;
          },
          error: (err) => err?.message || 'Failed to open cross position',
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
            if (err?.message?.includes('AllOraclesFailed')) {
              return 'Price feed unavailable. Please try again.';
            }
            return err?.message || 'Failed to open position';
          },
        });

        try {
          await openPositionPromise;
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

      const placeLimitOrderPromise = placeLimitOrder(publicKey, sign, {
        asset,
        direction,
        collateral: toPrecision(collateralNum),
        leverage,
        triggerPrice: triggerPricePrecision,
        triggerCondition,
        slippageToleranceBps: slippageTolerance,
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
          return err?.message || 'Failed to place limit order';
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

  // Percentage buttons for collateral
  const handlePercentage = (pct: number) => {
    setCollateral(Math.floor(usdcBalance * (pct / 100)).toString());
  };

  return (
    <div className="h-full rounded-lg border border-white/10 bg-[#0a0a0a] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10">
        <h3 className="text-sm font-medium text-foreground">Place Order</h3>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Margin Mode Toggle */}
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

        {/* Cross-Margin Balance */}
        {marginMode === 'Cross' && (
          <div className="p-2 bg-amber-500/10 rounded border border-amber-500/20 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-amber-500">Cross Balance</span>
              <span className="font-mono text-foreground">{formatNumber(crossBalance)} USDC</span>
            </div>
            {showCrossDeposit ? (
              <div className="flex gap-1.5">
                <input
                  type="text"
                  inputMode="decimal"
                  value={crossDepositAmount}
                  onChange={(e) => setCrossDepositAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="Amount"
                  className="flex-1 bg-zinc-900/50 border border-white/10 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                <button onClick={handleCrossDeposit} disabled={isSubmitting} className="px-3 py-1.5 text-xs bg-amber-500 text-black rounded font-medium">Deposit</button>
                <button onClick={() => setShowCrossDeposit(false)} className="px-2 py-1.5 text-xs text-muted-foreground border border-white/10 rounded">X</button>
              </div>
            ) : (
              <button onClick={() => setShowCrossDeposit(true)} className="w-full py-1.5 text-xs text-amber-500 border border-amber-500/30 rounded hover:bg-amber-500/10">
                + Deposit to Pool
              </button>
            )}
          </div>
        )}

        {/* Order Type Tabs */}
        <div className="grid grid-cols-4 gap-0 rounded-lg overflow-hidden border border-white/10">
          {(['Market', 'Limit', 'StopLimit', 'TrailingStop'] as const).map((type) => (
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

        {/* Long/Short Tabs */}
        <div className="grid grid-cols-2 gap-0 rounded-lg overflow-hidden border border-white/10">
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
        </div>

        {/* Pay (Collateral) Input */}
        <div className="space-y-2">
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
              Balance: <span className="font-mono text-foreground">{formatNumber(usdcBalance)}</span> USDC
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
        </div>

        {/* Leverage Slider */}
        <div className="space-y-3 p-3 bg-secondary/20 rounded-lg border border-white/5">
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
        </div>

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
          </div>
        )}

        {/* Stop Limit Settings */}
        {orderType === 'StopLimit' && (
          <div className="space-y-3 p-3 bg-purple-500/10 rounded-lg border border-purple-500/20">
            <h4 className="text-xs font-medium text-purple-400 uppercase tracking-wider">
              Stop Limit Settings
            </h4>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Stop Price (triggers monitoring)</label>
              <input
                type="text"
                inputMode="decimal"
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="Stop price"
                className="w-full bg-zinc-900/50 border border-white/10 rounded-md px-3 py-2 text-right font-mono text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Limit Price (execution price)</label>
              <input
                type="text"
                inputMode="decimal"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="Limit price"
                className="w-full bg-zinc-900/50 border border-white/10 rounded-md px-3 py-2 text-right font-mono text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              When price hits stop, a limit order at your limit price activates.
            </p>
          </div>
        )}

        {/* Trailing Stop Settings */}
        {orderType === 'TrailingStop' && (
          <div className="space-y-3 p-3 bg-cyan-500/10 rounded-lg border border-cyan-500/20">
            <h4 className="text-xs font-medium text-cyan-400 uppercase tracking-wider">
              Trailing Stop Settings
            </h4>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Position ID</label>
              <input
                type="text"
                inputMode="numeric"
                value={trailingPositionId}
                onChange={(e) => setTrailingPositionId(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="Enter position ID"
                className="w-full bg-zinc-900/50 border border-white/10 rounded-md px-3 py-2 text-right font-mono text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
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
                Fee ({isMaker ? 'Maker' : 'Taker'} {(feeBps / 100).toFixed(2)}%)
              </span>
              <span className="font-mono text-xs text-muted-foreground">{formatUSD(tradingFee)}</span>
            </div>
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
