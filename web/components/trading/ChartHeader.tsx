'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { fetchTicker, subscribeToPriceUpdates } from '@/lib/hooks/usePriceData';
import { formatUSD, formatNumber, formatPercent } from '@/lib/utils';
import { cn } from '@/lib/utils/cn';
import type { Ticker } from '@/types';

interface ChartHeaderProps {
  asset: string;
  className?: string;
}

export function ChartHeader({ asset, className }: ChartHeaderProps) {
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [priceFlash, setPriceFlash] = useState<'up' | 'down' | null>(null);

  // Fetch initial ticker data
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

  // Subscribe to real-time updates
  useEffect(() => {
    if (!ticker) return;

    let lastPrice = ticker.price;

    const unsubscribe = subscribeToPriceUpdates(asset, (newPrice) => {
      setTicker((prev) => {
        if (!prev) return prev;

        // Determine price direction for flash effect
        if (newPrice > lastPrice) {
          setPriceFlash('up');
        } else if (newPrice < lastPrice) {
          setPriceFlash('down');
        }
        lastPrice = newPrice;

        // Clear flash after animation
        setTimeout(() => setPriceFlash(null), 200);

        return { ...prev, price: newPrice };
      });
    });

    return unsubscribe;
  }, [asset, ticker?.price]);

  const isPositive = ticker ? ticker.changePercent24h >= 0 : true;

  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-6 p-4', className)}>
        <div className="animate-pulse">
          <div className="h-4 w-20 bg-white/10 rounded mb-2" />
          <div className="h-8 w-32 bg-white/10 rounded" />
        </div>
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
            {ticker ? formatUSD(ticker.price, asset === 'XLM' ? 4 : 2) : '--'}
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
              {formatUSD(ticker.high24h, asset === 'XLM' ? 4 : 2)}
            </p>
          </div>

          <div className="hidden sm:block">
            <p className="text-xs text-neutral-500 mb-1">24h Low</p>
            <p className="text-sm font-medium text-white">
              {formatUSD(ticker.low24h, asset === 'XLM' ? 4 : 2)}
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
