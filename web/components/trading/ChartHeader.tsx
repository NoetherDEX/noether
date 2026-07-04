'use client';

import { useEffect, useRef, useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { fetchTicker, subscribeToPriceUpdates } from '@/lib/hooks/usePriceData';
import { formatUSD, formatNumber, formatPercent, priceDecimals } from '@/lib/utils';
import { cn } from '@/lib/utils/cn';
import type { Ticker } from '@/types';

interface ChartHeaderProps {
  asset: string;
  className?: string;
  compact?: boolean;
  /**
   * Live Noeracle mark price (the source the protocol executes against).
   * When > 0 it drives the displayed price; the Binance ticker below is
   * kept only for 24h high/low/volume reference (W-1/P4-13).
   */
  markPrice?: number;
}

export function ChartHeader({ asset, className, compact = false, markPrice = 0 }: ChartHeaderProps) {
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [priceFlash, setPriceFlash] = useState<'up' | 'down' | null>(null);

  // Fetch initial ticker data (Binance — reference for 24h stats)
  useEffect(() => {
    const loadTicker = async () => {
      try {
        const data = await fetchTicker(asset);
        setTicker(data);
      } catch (error) {
        console.error('Failed to fetch ticker:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadTicker();
  }, [asset]);

  // Keep the Binance ticker's price fresh (drives 24h reference stats only
  // when the Noeracle mark isn't streaming yet).
  useEffect(() => {
    if (!ticker) return;
    const unsubscribe = subscribeToPriceUpdates(asset, (newPrice) => {
      setTicker((prev) => (prev ? { ...prev, price: newPrice } : prev));
    });
    return unsubscribe;
  }, [asset, ticker]);

  // The displayed price prefers the live Noeracle mark (execution source);
  // fall back to the Binance ticker until the first SSE frame arrives.
  const displayPrice = markPrice > 0 ? markPrice : ticker?.price ?? 0;

  // Flash on the DISPLAYED price's movement (so the flash matches the number).
  const lastDisplayRef = useRef(displayPrice);
  useEffect(() => {
    const prev = lastDisplayRef.current;
    if (displayPrice > prev) setPriceFlash('up');
    else if (displayPrice < prev) setPriceFlash('down');
    lastDisplayRef.current = displayPrice;
    const t = setTimeout(() => setPriceFlash(null), 200);
    return () => clearTimeout(t);
  }, [displayPrice]);

  const isPositive = ticker ? ticker.changePercent24h >= 0 : true;

  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-6', !compact && 'p-4', className)}>
        <div className="animate-pulse">
          <div className="h-4 w-20 bg-white/10 rounded" />
        </div>
      </div>
    );
  }

  // Compact mode: just show stats without the main price (shown in dropdown)
  if (compact) {
    return (
      <div className={cn('flex items-center gap-4', className)}>
        {ticker && (
          <>
            <div>
              <p className="text-[10px] text-neutral-500 mb-0.5">24h High</p>
              <p className="text-xs font-medium text-white font-mono">
                {formatUSD(ticker.high24h, priceDecimals(asset))}
              </p>
            </div>

            <div>
              <p className="text-[10px] text-neutral-500 mb-0.5">24h Low</p>
              <p className="text-xs font-medium text-white font-mono">
                {formatUSD(ticker.low24h, priceDecimals(asset))}
              </p>
            </div>

            <div className="hidden lg:block">
              <p className="text-[10px] text-neutral-500 mb-0.5">24h Volume</p>
              <p className="text-xs font-medium text-white font-mono">
                ${formatNumber(ticker.volume24h / 1_000_000, 2)}M
              </p>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-6 p-4', className)}>
      {/* Asset name and price */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg font-semibold text-white">{asset}/USD</span>
          <span className="text-xs text-neutral-500">Perpetual</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-3xl font-bold transition-colors duration-200',
              priceFlash === 'up' && 'text-emerald-400',
              priceFlash === 'down' && 'text-red-400',
              !priceFlash && 'text-white'
            )}
          >
            {displayPrice > 0 ? formatUSD(displayPrice, priceDecimals(asset)) : '--'}
          </span>
          {ticker && (
            <div
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-medium',
                isPositive
                  ? 'bg-emerald-400/10 text-emerald-400'
                  : 'bg-red-400/10 text-red-400'
              )}
            >
              {isPositive ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              {formatPercent(ticker.changePercent24h)}
            </div>
          )}
        </div>
      </div>

      {/* 24h Stats */}
      {ticker && (
        <>
          <div className="hidden sm:block">
            <p className="text-xs text-neutral-500 mb-1">24h High</p>
            <p className="text-sm font-medium text-white">
              {formatUSD(ticker.high24h, priceDecimals(asset))}
            </p>
          </div>

          <div className="hidden sm:block">
            <p className="text-xs text-neutral-500 mb-1">24h Low</p>
            <p className="text-sm font-medium text-white">
              {formatUSD(ticker.low24h, priceDecimals(asset))}
            </p>
          </div>

          <div className="hidden md:block">
            <p className="text-xs text-neutral-500 mb-1">24h Volume</p>
            <p className="text-sm font-medium text-white">
              ${formatNumber(ticker.volume24h / 1_000_000, 2)}M
            </p>
          </div>
        </>
      )}
    </div>
  );
}
