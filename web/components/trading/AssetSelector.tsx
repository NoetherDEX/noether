'use client';

import { useState } from 'react';
import { TrendingUp, TrendingDown, Bitcoin, CircleDollarSign } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { fetchTicker } from '@/lib/hooks/usePriceData';
import { formatUSD, formatPercent } from '@/lib/utils';
import { useEffect } from 'react';
import type { Ticker } from '@/types';

interface AssetSelectorProps {
  selectedAsset: string;
  onSelect: (asset: string) => void;
}

const ASSETS = [
  { symbol: 'BTC', name: 'Bitcoin', icon: Bitcoin },
  { symbol: 'ETH', name: 'Ethereum', icon: CircleDollarSign },
  { symbol: 'XLM', name: 'Stellar', icon: CircleDollarSign },
];

export function AssetSelector({ selectedAsset, onSelect }: AssetSelectorProps) {
  const [tickers, setTickers] = useState<Record<string, Ticker>>({});

  useEffect(() => {
    const loadTickers = async () => {
      const results: Record<string, Ticker> = {};
      for (const asset of ASSETS) {
        try {
          results[asset.symbol] = await fetchTicker(asset.symbol);
        } catch (error) {
          console.error(`Failed to fetch ${asset.symbol} ticker:`, error);
        }
      }
      setTickers(results);
    };

    loadTickers();
    const interval = setInterval(loadTickers, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-1">
      {ASSETS.map((asset) => {
        const ticker = tickers[asset.symbol];
        const isSelected = selectedAsset === asset.symbol;
        const isPositive = ticker ? ticker.changePercent24h >= 0 : true;

        return (
          <button
            key={asset.symbol}
            onClick={() => onSelect(asset.symbol)}
            className={cn(
              'w-full flex items-center justify-between p-3 rounded-xl transition-all',
              isSelected
                ? 'bg-white/10 border border-white/20'
                : 'hover:bg-white/5 border border-transparent'
            )}
          >
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center',
                  asset.symbol === 'BTC'
                    ? 'bg-orange-500/20 text-orange-400'
                    : asset.symbol === 'ETH'
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-emerald-500/20 text-emerald-400'
                )}
              >
                <asset.icon className="w-5 h-5" />
              </div>
              <div className="text-left">
                <p className="font-medium text-white">{asset.symbol}/USD</p>
                <p className="text-xs text-neutral-500">{asset.name}</p>
              </div>
            </div>

            <div className="text-right">
              <p className="font-medium text-white">
                {ticker
                  ? formatUSD(ticker.price, asset.symbol === 'XLM' ? 4 : 2)
                  : '--'}
              </p>
              {ticker && (
                <p
                  className={cn(
                    'text-xs flex items-center justify-end gap-1',
                    isPositive ? 'text-emerald-400' : 'text-red-400'
                  )}
                >
                  {isPositive ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : (
                    <TrendingDown className="w-3 h-3" />
                  )}
                  {formatPercent(ticker.changePercent24h)}
                </p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
