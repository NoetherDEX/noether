'use client';

import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { TokenIcon } from '@/components/ui/TokenIcon';
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
        <TokenIcon symbol={selectedAsset} size={24} />

        {/* Asset Info */}
        <div className="text-left">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-foreground">{selectedAsset}-PERP</span>
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
                <TokenIcon symbol={asset.symbol} size={32} />

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

              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
