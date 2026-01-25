'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { AlertCircle, Info, CheckCircle2, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, Slider } from '@/components/ui';
import { useWallet } from '@/lib/hooks/useWallet';
import { useTradeStore } from '@/lib/store';
import { fetchTicker } from '@/lib/hooks/usePriceData';
import { openPosition } from '@/lib/stellar/market';
import { approveUSDC, checkMarketAllowance } from '@/lib/stellar/token';
import { CONTRACTS, TRADING } from '@/lib/utils/constants';
import {
  formatUSD,
  formatNumber,
  calculateLiquidationPrice,
  toPrecision,
} from '@/lib/utils';
import { cn } from '@/lib/utils/cn';

interface OrderPanelProps {
  asset: string;
  onSubmit?: () => void;
}

export function OrderPanel({ asset, onSubmit }: OrderPanelProps) {
  const { isConnected, publicKey, xlmBalance, usdcBalance, sign, refreshBalances } = useWallet();
  const {
    direction,
    collateral,
    leverage,
    setDirection,
    setCollateral,
    setLeverage,
  } = useTradeStore();

  // Price states
  const [assetPrice, setAssetPrice] = useState<number>(0);

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
      } catch (error) {
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

  // Handle position submission
  const handleSubmit = async () => {
    if (!canSubmit || !publicKey) return;

    setIsSubmitting(true);

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
        return `${direction} ${asset} position opened! ID: ${position.id}`;
      },
      error: (err) => {
        console.error('Failed to open position:', err);
        // Parse common errors
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
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full">
      {/* Direction Toggle */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setDirection('Long')}
          className={cn(
            'flex-1 py-3 rounded-xl font-semibold text-sm transition-all',
            direction === 'Long'
              ? 'bg-emerald-500 text-white'
              : 'bg-white/5 text-neutral-400 hover:bg-white/10'
          )}
        >
          Long {asset}
        </button>
        <button
          onClick={() => setDirection('Short')}
          className={cn(
            'flex-1 py-3 rounded-xl font-semibold text-sm transition-all',
            direction === 'Short'
              ? 'bg-red-500 text-white'
              : 'bg-white/5 text-neutral-400 hover:bg-white/10'
          )}
        >
          Short {asset}
        </button>
      </div>

      {/* Collateral Input */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-neutral-400">Collateral</span>
            <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded font-medium">USDC</span>
          </div>
          {isConnected && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-500">
                Bal: {formatNumber(usdcBalance)} USDC
              </span>
              {/* Quick percent buttons */}
              <div className="flex gap-1">
                <button
                  onClick={() => setCollateral(Math.floor(usdcBalance * 0.25).toString())}
                  className="px-2 py-0.5 text-[10px] font-medium text-neutral-400 bg-white/5 hover:bg-white/10 hover:text-white rounded transition-all"
                >
                  25%
                </button>
                <button
                  onClick={() => setCollateral(Math.floor(usdcBalance * 0.5).toString())}
                  className="px-2 py-0.5 text-[10px] font-medium text-neutral-400 bg-white/5 hover:bg-white/10 hover:text-white rounded transition-all"
                >
                  50%
                </button>
                <button
                  onClick={() => setCollateral(Math.floor(usdcBalance * 0.95).toString())}
                  className="px-2 py-0.5 text-[10px] font-medium text-emerald-400/80 bg-emerald-500/10 hover:bg-emerald-500/20 hover:text-emerald-300 rounded transition-all"
                >
                  Max
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Input box */}
        <div className="relative bg-gray-900/80 border border-white/5 rounded-xl p-4 hover:border-white/10 transition-colors focus-within:border-white/20 focus-within:ring-1 focus-within:ring-white/10">
          <input
            type="number"
            value={collateral}
            onChange={(e) => setCollateral(e.target.value)}
            placeholder="0.00"
            className={cn(
              'w-full bg-transparent text-2xl font-semibold text-white placeholder-neutral-600',
              'focus:outline-none',
              '[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
              '[&::-webkit-outer-spin-button]:m-0 [&::-webkit-inner-spin-button]:m-0',
              '[appearance:textfield]'
            )}
          />
          {/* Token badge */}
          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
              <span className="text-[10px] font-bold text-white">$</span>
            </div>
            <span className="text-sm font-medium text-white">USDC</span>
          </div>
        </div>

        {/* USD value display */}
        <div className="mt-2 pl-1 flex items-center justify-between">
          <span className="text-xs text-neutral-500">
            ≈ {formatUSD(collateralNum)}
          </span>
          {/* Allowance status */}
          {isConnected && collateralNum > 0 && (
            <div className="flex items-center gap-1">
              {isCheckingAllowance ? (
                <Loader2 className="w-3 h-3 text-neutral-500 animate-spin" />
              ) : hasAllowance ? (
                <>
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  <span className="text-[10px] text-emerald-500">Approved</span>
                </>
              ) : (
                <span className="text-[10px] text-amber-500">Approval needed</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Leverage Slider */}
      <div className="mb-6">
        <Slider
          label="Leverage"
          min={1}
          max={10}
          step={1}
          value={leverage}
          onChange={(newLeverage) => setLeverage(newLeverage)}
          marks={[1, 2, 5, 10]}
          formatValue={(v) => `${v}x`}
        />
      </div>

      {/* Order Summary */}
      <div className="mb-6 space-y-3">
        {/* Position Size */}
        <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-400">Position Size</span>
              <span className="text-[10px] text-neutral-600">
                ({formatUSD(collateralNum)} × {leverage}x)
              </span>
            </div>
            <span className="text-lg font-semibold text-white">
              {formatUSD(positionSize)}
            </span>
          </div>
        </div>

        {/* Price Info */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4">
            <div className="text-xs text-neutral-500 mb-1">{asset} Entry Price</div>
            <div className="text-base font-medium text-white">
              {assetPrice > 0 ? formatUSD(assetPrice, asset === 'XLM' ? 4 : 2) : '--'}
            </div>
          </div>

          <div className={cn(
            'border rounded-xl p-4',
            direction === 'Long'
              ? 'bg-red-500/5 border-red-500/10'
              : 'bg-emerald-500/5 border-emerald-500/10'
          )}>
            <div className="text-xs text-neutral-500 mb-1">Liq. Price</div>
            <div className={cn(
              'text-base font-medium',
              direction === 'Long' ? 'text-red-400' : 'text-emerald-400'
            )}>
              {liquidationPrice > 0 ? formatUSD(liquidationPrice, asset === 'XLM' ? 4 : 2) : '--'}
            </div>
          </div>
        </div>

        {/* Fees */}
        <div className="bg-neutral-900/50 border border-white/5 rounded-xl p-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-400">Trading Fee</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-white/5 rounded text-neutral-500">0.1%</span>
            </div>
            <span className="text-sm font-medium text-neutral-300">
              {formatUSD(tradingFee)}
            </span>
          </div>
        </div>
      </div>

      {/* Gas Info */}
      {isConnected && (
        <div className="mb-4 p-3 bg-neutral-900/50 border border-white/5 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">Gas (XLM)</span>
          </div>
          <span className={cn(
            'text-xs font-medium',
            xlmBalance < 1 ? 'text-red-400' : 'text-neutral-400'
          )}>
            {formatNumber(xlmBalance, 2)} XLM
          </span>
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && collateralNum > 0 && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          {errors.map((error, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-red-400">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          ))}
        </div>
      )}

      {/* Action Buttons */}
      {!hasAllowance && collateralNum >= 10 && errors.length === 0 ? (
        // Approval Button
        <Button
          variant="primary"
          size="lg"
          className="w-full bg-amber-500 hover:bg-amber-600"
          onClick={handleApprove}
          disabled={!canApprove}
          isLoading={isApproving}
        >
          Approve USDC
        </Button>
      ) : (
        // Trade Button
        <Button
          variant={direction === 'Long' ? 'success' : 'danger'}
          size="lg"
          className="w-full"
          onClick={handleSubmit}
          disabled={!canSubmit}
          isLoading={isSubmitting}
        >
          {!isConnected
            ? 'Connect Wallet'
            : `${direction} ${asset} with ${collateralNum > 0 ? formatNumber(collateralNum, 0) : '0'} USDC`}
        </Button>
      )}

      {/* Risk Warning */}
      <p className="mt-4 text-xs text-neutral-600 text-center">
        Trading with leverage carries significant risk. You may lose more than your initial investment.
      </p>
    </Card>
  );
}
