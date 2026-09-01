'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { formatPrice, formatPercent } from '@/lib/utils';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { fetchTicker } from '@/lib/hooks/usePriceData';

interface AssetOption {
  symbol: string;
  name: string;
  price: number;
  /** 24h change in percent (Binance reference); null = fetch failed → '—'. */
  changePercent24h: number | null;
}

interface AssetSelectorDropdownProps {
  selectedAsset: string;
  onSelect: (asset: string) => void;
  /**
   * Live Noeracle mark prices by symbol (execution source). When present
   * they override the Binance price shown in the selector; the Binance
   * fetch stays as the 24h-change source + fallback (W-1/P4-13).
   */
  markPrices?: Record<string, number>;
}

const ASSETS = [
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'XLM', name: 'Stellar' },
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'XRP', name: 'XRP' },
  { symbol: 'ADA', name: 'Cardano' },
  { symbol: 'BNB', name: 'BNB' },
  { symbol: 'TRX', name: 'Tron' },
  { symbol: 'DOGE', name: 'Dogecoin' },
  { symbol: 'ZEC', name: 'Zcash' },
  { symbol: 'LINK', name: 'Chainlink' },
  { symbol: 'BCH', name: 'Bitcoin Cash' },
  { symbol: 'LTC', name: 'Litecoin' },
];

export function AssetSelectorDropdown({ selectedAsset, onSelect, markPrices }: AssetSelectorDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const openMenu = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) {
      setMenuPos({
        top: r.bottom + 4,
        left: Math.max(8, Math.min(r.left, window.innerWidth - 248)),
      });
      setIsOpen(true);
    }
  };

  // The menu is viewport-anchored: close it if the page shifts under it.
  // Escape closes and returns focus to the trigger (B29).
  useEffect(() => {
    if (!isOpen) return;
    const close = () => setIsOpen(false);
    const onScroll = (e: globalThis.Event) => {
      // The scroll listener is capture-phase, so it also sees the menu's OWN
      // overflow-y-auto scrolling — which must not close it (the whole list
      // is reachable only by scrolling). Only page/ancestor scrolls that
      // move the fixed-position anchor should close.
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      setIsOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);
  // Every pair renders from the first frame — prices fill in as fetches
  // land. An empty initial state made the menu depend on 13 parallel
  // ticker fetches, so a slow/rate-limited response hid the whole list.
  const [assets, setAssets] = useState<AssetOption[]>(() =>
    ASSETS.map((a) => ({ ...a, price: 0, changePercent24h: null }))
  );

  // Fetch Binance prices for the 24h change + as a fallback until the
  // Noeracle marks stream in.
  useEffect(() => {
    const loadPrices = async () => {
      const assetPromises = ASSETS.map(async (asset): Promise<AssetOption> => {
        try {
          const ticker = await fetchTicker(asset.symbol);
          return {
            ...asset,
            price: ticker.price,
            changePercent24h: ticker.changePercent24h,
          };
        } catch {
          return {
            ...asset,
            price: 0,
            changePercent24h: null, // unknown → '—', never a fabricated 0.00%
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

  // Prefer the live Noeracle mark for the displayed price; keep the Binance
  // change24h. Falls back to the Binance price before the first SSE frame.
  const priceFor = (symbol: string, binancePrice: number): number => {
    const mark = markPrices?.[symbol];
    return mark && mark > 0 ? mark : binancePrice;
  };

  const displayAssets = assets.map((a) => ({ ...a, price: priceFor(a.symbol, a.price) }));

  const selectedAssetData: AssetOption = displayAssets.find(a => a.symbol === selectedAsset) || {
    symbol: selectedAsset,
    name: selectedAsset,
    price: markPrices?.[selectedAsset] ?? 0,
    changePercent24h: null,
  };

  // Signed, colored 24h % (Binance reference stat) — was fetched every 10s
  // and rendered nowhere (A13).
  const changeBadge = (change: number | null, className?: string) =>
    change == null ? (
      <span className={cn('font-mono tabular-nums text-muted-foreground', className)}>—</span>
    ) : (
      <span
        className={cn(
          'font-mono tabular-nums',
          change > 0 ? 'text-long' : change < 0 ? 'text-short' : 'text-muted-foreground',
          className,
        )}
      >
        {formatPercent(change)}
      </span>
    );

  return (
    <div className="relative">
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label="Select trading pair"
        className={cn(
          'flex h-9 items-center gap-2 px-2.5 rounded-md border transition-colors',
          'bg-surface-2 border-border hover:bg-surface-3 hover:border-border-strong',
          isOpen && 'border-primary/50 ring-1 ring-primary/20'
        )}
      >
        {/* Asset Icon */}
        <TokenIcon symbol={selectedAsset} size={20} />

        {/* Asset Info */}
        <div className="flex items-baseline gap-2 text-left">
          <span className="text-[13px] font-semibold text-foreground">{selectedAsset}-PERP</span>
          <span className="text-xs text-muted-foreground font-mono tabular-nums">
            {selectedAssetData.price > 0 ? formatPrice(selectedAssetData.price) : '—'}
          </span>{' '}
          {changeBadge(selectedAssetData.changePercent24h, 'text-[10px]')}
        </div>

        {/* Chevron */}
        <ChevronDown className={cn(
          'w-4 h-4 text-muted-foreground transition-transform',
          isOpen && 'rotate-180'
        )} />
      </button>

      {/* Dropdown Menu — rendered in a portal with viewport (fixed)
          coordinates: the stats bar scrolls horizontally (overflow-x-auto),
          and any overflow on an ancestor clips absolutely-positioned
          children — which cut this menu down to a sliver. */}
      {isOpen && menuPos && createPortal(
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Menu — height-capped so all 13 pairs stay reachable by scrolling
              on short/mobile viewports; overscroll-contain stops the page
              behind from scrolling when the list hits its edge. */}
          <div
            ref={menuRef}
            style={{ top: menuPos.top, left: menuPos.left }}
            className="fixed z-50 min-w-[220px] max-h-[min(60vh,480px)] bg-surface-2 border border-border-strong rounded-md overflow-y-auto overscroll-contain custom-scrollbar divide-y divide-border shadow-2xl">
            {displayAssets.map((asset) => (
              <button
                key={asset.symbol}
                onClick={() => {
                  onSelect(asset.symbol);
                  setIsOpen(false);
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 hover:bg-surface-3 transition-colors',
                  asset.symbol === selectedAsset && 'bg-primary/10'
                )}
              >
                {/* Asset Icon */}
                <TokenIcon symbol={asset.symbol} size={24} />

                {/* Asset Info */}
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-1">
                    <span className="text-[13px] font-medium text-foreground">{asset.symbol}-PERP</span>
                    <span className="text-xs text-faint">{asset.name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground font-mono tabular-nums">
                    {asset.price > 0 ? formatPrice(asset.price) : '—'}
                  </span>
                </div>

                {/* 24h change (Binance reference) */}
                {changeBadge(asset.changePercent24h, 'text-xs')}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
