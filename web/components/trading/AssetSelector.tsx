'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { fetchTicker } from '@/lib/hooks/usePriceData';
import { formatUSD, formatPercent } from '@/lib/utils';
import type { Ticker } from '@/types';

interface AssetSelectorProps {
  selectedAsset: string;
  onSelect: (asset: string) => void;
}

const ASSETS = [
  { symbol: 'BTC', name: 'Bitcoin', color: '#f7931a' },
  { symbol: 'ETH', name: 'Ethereum', color: '#627eea' },
  { symbol: 'XLM', name: 'Stellar', color: '#08b5e5' },
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
              'w-full flex items-center justify-between p-3 rounded-lg transition-all',
              isSelected
                ? 'bg-gradient-to-r from-[#8b5cf6]/20 to-[#3b82f6]/20 border border-[#8b5cf6]/30'
                : 'hover:bg-white/5 border border-transparent'
            )}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs"
                style={{ backgroundColor: `${asset.color}20`, color: asset.color }}
              >
                {asset.symbol.charAt(0)}
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-foreground">{asset.symbol}-USDC</p>
                <p className="text-xs text-muted-foreground">{asset.name}</p>
              </div>
            </div>

            <div className="text-right">
              <p className="font-mono text-sm text-foreground">
                {ticker
                  ? formatUSD(ticker.price, asset.symbol === 'XLM' ? 4 : 2)
                  : '--'}
              </p>
              {ticker && (
                <p
                  className={cn(
                    'text-xs font-mono flex items-center justify-end gap-1',
                    isPositive ? 'text-[#22c55e]' : 'text-[#ef4444]'
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
