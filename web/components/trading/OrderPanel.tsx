'use client';

import { useState, useEffect, useMemo } from 'react';
import { AlertCircle, Info, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useWallet } from '@/lib/hooks/useWallet';
import { useTradeStore } from '@/lib/store';
import { fetchTicker } from '@/lib/hooks/usePriceData';
import { openPosition, placeLimitOrder } from '@/lib/stellar/market';
import { approveUSDC, checkMarketAllowance } from '@/lib/stellar/token';
import { CONTRACTS, TRADING } from '@/lib/utils/constants';
import {
  formatUSD,
  formatNumber,
  calculateLiquidationPrice,
  toPrecision,
} from '@/lib/utils';
import { cn } from '@/lib/utils/cn';
import { TokenIcon } from '@/components/ui/TokenIcon';
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
  const [orderType, setOrderType] = useState<'Market' | 'Limit'>('Market');

  // Price states
  const [assetPrice, setAssetPrice] = useState<number>(0);

  // Limit order states
  const [triggerPrice, setTriggerPrice] = useState<string>('');
  const [slippageTolerance, setSlippageTolerance] = useState<number>(50); // 0.5% = 50 bps (default)
  const [customSlippage, setCustomSlippage] = useState<string>('');

  // UI states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  // Allowance state
  const [hasAllowance, setHasAllowance] = useState(false);
  const [isCheckingAllowance, setIsCheckingAllowance] = useState(false);

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

  // Calculate derived values
  const collateralNum = parseFloat(collateral) || 0;
  const collateralPrecision = BigInt(Math.floor(collateralNum * TRADING.PRECISION));

  // Position size in USD (collateral is already in USD since it's USDC)
  const positionSize = collateralNum * leverage;

  const liquidationPrice = useMemo(
    () =>
      assetPrice > 0
        ? calculateLiquidationPrice(assetPrice, leverage, direction === 'Long')
        : 0,
    [assetPrice, leverage, direction]
  );

  const tradingFee = positionSize * 0.001; // 0.1%

  // Risk assessment based on leverage
  const liquidationRisk = leverage >= 8 ? 'high' : leverage >= 5 ? 'medium' : 'low';

  // Check allowance when collateral changes
  useEffect(() => {
    const checkAllowance = async () => {
      if (!publicKey || collateralNum <= 0) {
        setHasAllowance(false);
        return;
      }

      setIsCheckingAllowance(true);
      try {
        const { hasAllowance: allowed } = await checkMarketAllowance(
          publicKey,
          collateralPrecision
        );
        setHasAllowance(allowed);
      } catch (error) {
        console.error('Error checking allowance:', error);
        setHasAllowance(false);
      } finally {
        setIsCheckingAllowance(false);
      }
    };

    // Debounce the check
    const timer = setTimeout(checkAllowance, 300);
    return () => clearTimeout(timer);
  }, [publicKey, collateralNum, collateralPrecision]);

  // Validation
  const errors: string[] = [];
  if (collateralNum > 0 && collateralNum < 10) errors.push('Minimum collateral is 10 USDC');
  if (collateralNum > usdcBalance) errors.push('Insufficient USDC balance');
  if (positionSize > 100000) errors.push('Position size exceeds $100,000 maximum');
  if (xlmBalance < 1) errors.push('Need XLM for gas fees');
  if (orderType === 'Limit') {
    if (slippageTolerance <= 0 || slippageTolerance > 10000) errors.push('Slippage must be between 0.01% and 100%');
    const triggerPriceNum = parseFloat(triggerPrice) || 0;
    if (triggerPriceNum <= 0) errors.push('Enter a valid trigger price');
  }

  const canApprove = isConnected && collateralNum >= 10 && !hasAllowance && errors.length === 0;
  const canSubmit = isConnected && collateralNum >= 10 && hasAllowance && errors.length === 0;

  // Handle approval
  const handleApprove = async () => {
    if (!canApprove || !publicKey) return;

    setIsApproving(true);

    // Approve a large amount so user doesn't have to re-approve often
    const approvalAmount = BigInt(1_000_000 * TRADING.PRECISION); // 1M USDC

    const approvePromise = approveUSDC(publicKey, sign, CONTRACTS.MARKET, approvalAmount);

    toast.promise(approvePromise, {
      loading: 'Approving USDC...',
      success: () => {
        setHasAllowance(true);
        return 'USDC approved! You can now open positions.';
      },
      error: (err) => {
        console.error('Approval failed:', err);
        return err?.message || 'Failed to approve USDC';
      },
    });

    try {
      await approvePromise;
    } catch {
      // Error handled by toast
    } finally {
      setIsApproving(false);
    }
  };

  // Handle position submission (market or limit)
  const handleSubmit = async () => {
    if (!canSubmit || !publicKey) return;

    setIsSubmitting(true);

    if (orderType === 'Market') {
      // Market order - immediate execution
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
        {/* Market/Limit Order Type Tabs */}
        <div className="grid grid-cols-2 gap-0 rounded-lg overflow-hidden border border-white/10">
          <button
            onClick={() => setOrderType('Market')}
            className={cn(
              'py-2 text-sm font-medium transition-all',
              orderType === 'Market'
                ? 'bg-primary/20 text-primary border-b-2 border-primary'
                : 'bg-secondary/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            )}
          >
            Market
          </button>
          <button
            onClick={() => setOrderType('Limit')}
            className={cn(
              'py-2 text-sm font-medium transition-all',
              orderType === 'Limit'
                ? 'bg-primary/20 text-primary border-b-2 border-primary'
                : 'bg-secondary/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            )}
          >
            Limit
          </button>
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
            {/* Allowance status */}
            {isConnected && collateralNum > 0 && (
              <div className="flex items-center gap-1">
                {isCheckingAllowance ? (
                  <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />
                ) : hasAllowance ? (
                  <>
                    <CheckCircle2 className="w-3 h-3 text-[#22c55e]" />
                    <span className="text-[10px] text-[#22c55e]">Approved</span>
                  </>
                ) : (
                  <span className="text-[10px] text-amber-500">Approval needed</span>
                )}
              </div>
            )}
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
            {/* Leverage scale markers */}
            <div className="flex justify-between mt-2 px-0.5">
              {[1, 2, 5, 8, 10].map((mark) => (
                <span
                  key={mark}
                  className={cn(
                    'text-[10px] font-mono',
                    leverage >= mark ? 'text-foreground' : 'text-muted-foreground/50'
                  )}
                >
                  {mark}x
                </span>
              ))}
            </div>
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
              <span className="text-xs text-muted-foreground">Fee (0.1%)</span>
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
        {!hasAllowance && collateralNum >= 10 && errors.length === 0 ? (
          <button
            onClick={handleApprove}
            disabled={!canApprove || isApproving}
            className={cn(
              'w-full h-14 text-base font-bold rounded-lg transition-all',
              'bg-amber-500 hover:bg-amber-600 text-white',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              'flex items-center justify-center gap-2'
            )}
          >
            {isApproving && <Loader2 className="w-5 h-5 animate-spin" />}
            Approve USDC
          </button>
        ) : (
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
              : `${direction === 'Long' ? 'Buy / Long' : 'Sell / Short'} ${asset}`}
          </button>
        )}

        {/* Risk Warning */}
        <p className="text-xs text-muted-foreground text-center">
          Trading with leverage carries significant risk. You may lose more than your initial investment.
        </p>
      </div>
    </div>
  );
}
