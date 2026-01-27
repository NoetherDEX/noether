'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { fetchTicker } from '@/lib/hooks/usePriceData';

interface AssetOption {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
}

interface AssetSelectorDropdownProps {
  selectedAsset: string;
  onSelect: (asset: string) => void;
}

const ASSETS = [
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'XLM', name: 'Stellar' },
];

export function AssetSelectorDropdown({ selectedAsset, onSelect }: AssetSelectorDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [assets, setAssets] = useState<AssetOption[]>([]);

  // Fetch prices for all assets
  useEffect(() => {
    const loadPrices = async () => {
      const assetPromises = ASSETS.map(async (asset) => {
        try {
          const ticker = await fetchTicker(asset.symbol);
          return {
            ...asset,
            price: ticker.price,
            change24h: ticker.change24h,
          };
        } catch {
          return {
            ...asset,
            price: 0,
            change24h: 0,
          };
        }
      });

      const loadedAssets = await Promise.all(assetPromises);
      setAssets(loadedAssets);
    };

    loadPrices();
    const interval = setInterval(loadPrices, 10000);
    return () => clearInterval(interval);
  }, []);

  const selectedAssetData = assets.find(a => a.symbol === selectedAsset) || {
    symbol: selectedAsset,
    name: selectedAsset,
    price: 0,
    change24h: 0,
  };

  const formatPrice = (price: number, symbol: string) => {
    if (symbol === 'XLM') return `$${price.toFixed(4)}`;
    return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="relative">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg border transition-all',
          'bg-zinc-900/50 border-white/10 hover:border-white/20',
          isOpen && 'border-primary/50 ring-1 ring-primary/20'
        )}
      >
        {/* Asset Icon */}
        <div className={cn(
          'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white',
          selectedAsset === 'BTC' && 'bg-[#f7931a]',
          selectedAsset === 'ETH' && 'bg-[#627eea]',
          selectedAsset === 'XLM' && 'bg-[#000000] ring-1 ring-white/20'
        )}>
          {selectedAsset.charAt(0)}
        </div>

        {/* Asset Info */}
        <div className="text-left">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-foreground">{selectedAsset}-PERP</span>
            {selectedAssetData.change24h !== 0 && (
              <span className={cn(
                'text-xs font-mono',
                selectedAssetData.change24h >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'
              )}>
                {selectedAssetData.change24h >= 0 ? '+' : ''}{selectedAssetData.change24h.toFixed(2)}%
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground font-mono">
            {formatPrice(selectedAssetData.price, selectedAsset)}
          </span>
        </div>

        {/* Chevron */}
        <ChevronDown className={cn(
          'w-4 h-4 text-muted-foreground transition-transform',
          isOpen && 'rotate-180'
        )} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Menu */}
          <div className="absolute top-full left-0 mt-1 z-50 min-w-[220px] bg-card border border-white/10 rounded-lg shadow-xl overflow-hidden">
            {assets.map((asset) => (
              <button
                key={asset.symbol}
                onClick={() => {
                  onSelect(asset.symbol);
                  setIsOpen(false);
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-900/50 transition-colors',
                  asset.symbol === selectedAsset && 'bg-primary/10'
                )}
              >
                {/* Asset Icon */}
                <div className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white',
                  asset.symbol === 'BTC' && 'bg-[#f7931a]',
                  asset.symbol === 'ETH' && 'bg-[#627eea]',
                  asset.symbol === 'XLM' && 'bg-[#000000] ring-1 ring-white/20'
                )}>
                  {asset.symbol.charAt(0)}
                </div>

                {/* Asset Info */}
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-medium text-foreground">{asset.symbol}</span>
                    <span className="text-xs text-muted-foreground">{asset.name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground font-mono">
                    {formatPrice(asset.price, asset.symbol)}
                  </span>
                </div>

                {/* Change */}
                <div className={cn(
                  'flex items-center gap-0.5 text-xs font-mono',
                  asset.change24h >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'
                )}>
                  {asset.change24h >= 0 ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : (
                    <TrendingDown className="w-3 h-3" />
                  )}
                  <span>{asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(2)}%</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
