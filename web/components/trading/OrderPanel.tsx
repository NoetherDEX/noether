'use client';

import { useState, useEffect, useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button, Card, Input, Slider } from '@/components/ui';
import { useWallet } from '@/lib/hooks/useWallet';
import { useTradeStore } from '@/lib/store';
import { fetchTicker } from '@/lib/hooks/usePriceData';
import {
  formatUSD,
  formatNumber,
  calculateLiquidationPrice,
  toPrecision,
} from '@/lib/utils';
import { cn } from '@/lib/utils/cn';
import type { Direction } from '@/types';

interface OrderPanelProps {
  asset: string;
  onSubmit?: () => void;
}

export function OrderPanel({ asset, onSubmit }: OrderPanelProps) {
  const { isConnected, xlmBalance } = useWallet();
  const {
    direction,
    collateral,
    leverage,
    setDirection,
    setCollateral,
    setLeverage,
  } = useTradeStore();

  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch current price
  useEffect(() => {
    const loadPrice = async () => {
      try {
        const ticker = await fetchTicker(asset);
        setCurrentPrice(ticker.price);
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
  const positionSize = collateralNum * leverage;
  const liquidationPrice = useMemo(
    () =>
      currentPrice > 0
        ? calculateLiquidationPrice(currentPrice, leverage, direction === 'Long')
        : 0,
    [currentPrice, leverage, direction]
  );
  const tradingFee = positionSize * 0.001; // 0.1%

  // Validation
  const errors: string[] = [];
  if (collateralNum < 10) errors.push('Minimum collateral is 10 XLM');
  if (collateralNum > xlmBalance) errors.push('Insufficient balance');
  if (positionSize > 100000) errors.push('Position size exceeds maximum');

  const canSubmit = isConnected && collateralNum >= 10 && errors.length === 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      // TODO: Call contract
      console.log('Opening position:', {
        asset,
        direction,
        collateral: toPrecision(collateralNum),
        leverage,
      });

      onSubmit?.();
    } catch (error) {
      console.error('Failed to open position:', error);
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
          Long
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
          Short
        </button>
      </div>

      {/* Collateral Input */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-neutral-400">Collateral</span>
          {isConnected && (
            <button
              onClick={() => setCollateral(Math.floor(xlmBalance * 0.95).toString())}
              className="text-xs text-neutral-500 hover:text-white transition-colors"
            >
              Balance: {formatNumber(xlmBalance)} XLM
            </button>
          )}
        </div>
        <Input
          type="number"
          value={collateral}
          onChange={(e) => setCollateral(e.target.value)}
          placeholder="0.00"
          suffix="XLM"
          className="text-right text-xl font-semibold"
        />
      </div>

      {/* Leverage Slider */}
      <div className="mb-6">
        <Slider
          label="Leverage"
          min={1}
          max={10}
          step={1}
          value={leverage}
          onChange={setLeverage}
          marks={[1, 2, 5, 10]}
          formatValue={(v) => `${v}x`}
        />
      </div>

      {/* Order Summary */}
      <div className="space-y-3 mb-6 p-4 bg-white/5 rounded-xl">
        <div className="flex justify-between text-sm">
          <span className="text-neutral-400">Position Size</span>
          <span className="text-white font-medium">
            {formatUSD(positionSize)}
          </span>
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-neutral-400">Entry Price</span>
          <span className="text-white font-medium">
            {currentPrice > 0 ? formatUSD(currentPrice, asset === 'XLM' ? 4 : 2) : '--'}
          </span>
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-neutral-400">Liquidation Price</span>
          <span className={cn(
            'font-medium',
            direction === 'Long' ? 'text-red-400' : 'text-emerald-400'
          )}>
            {liquidationPrice > 0 ? formatUSD(liquidationPrice, asset === 'XLM' ? 4 : 2) : '--'}
          </span>
        </div>

        <div className="border-t border-white/10 pt-3 flex justify-between text-sm">
          <span className="text-neutral-400">Fee (0.1%)</span>
          <span className="text-neutral-300">
            {formatUSD(tradingFee)}
          </span>
        </div>
      </div>

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

      {/* Submit Button */}
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
          : direction === 'Long'
          ? `Long ${asset}`
          : `Short ${asset}`}
      </Button>

      {/* Risk Warning */}
      <p className="mt-4 text-xs text-neutral-600 text-center">
        Trading with leverage carries significant risk. You may lose more than your initial investment.
      </p>
    </Card>
  );
}
