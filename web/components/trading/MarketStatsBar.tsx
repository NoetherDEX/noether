'use client';

import { useEffect, useRef, useState } from 'react';
import { AssetSelectorDropdown } from './AssetSelectorDropdown';
import { Tooltip } from '@/components/ui';
import { fetchTicker, subscribeToPriceUpdates } from '@/lib/hooks/usePriceData';
import { formatUSD, formatNumber, formatPercent, priceDecimals } from '@/lib/utils';
import { formatCompactUsd } from '@/lib/utils/format';
import { statToUsd, type AssetMarketStats } from '@/lib/api/markets';
import { cn } from '@/lib/utils/cn';
import type { Ticker } from '@/types';

interface MarketStatsBarProps {
  selectedAsset: string;
  onSelect: (asset: string) => void;
  /** Live Noeracle mark prices by symbol (execution source). */
  markPrices: Record<string, number>;
  /** Hourly funding rate in percent; null = unknown → '—'. */
  fundingRate: number | null;
  /** Indexer market stats for the selected asset; null keeps placeholders. */
  assetStats: AssetMarketStats | null;
  /** True when the live price stream degraded to fallback polling. */
  pricesStale: boolean;
}

function Stat({
  label,
  children,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('shrink-0', className)}>
      <p className="text-[10px] leading-4 text-faint whitespace-nowrap">{label}</p>
      <p className="text-xs leading-4 font-mono text-foreground whitespace-nowrap">{children}</p>
    </div>
  );
}

/**
 * Thin full-width market-stats strip under the app header (trade screen):
 * pair selector · live mark · 24h change/high/low · venue OI + volume ·
 * funding. One row, horizontally scrollable below lg.
 */
export function MarketStatsBar({
  selectedAsset,
  onSelect,
  markPrices,
  fundingRate,
  assetStats,
  pricesStale,
}: MarketStatsBarProps) {
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [priceFlash, setPriceFlash] = useState<'up' | 'down' | null>(null);

  // Binance ticker = 24h reference stats (+ price fallback before the first
  // Noeracle SSE frame). Execution price is always the Noeracle mark.
  useEffect(() => {
    let active = true;
    setTicker(null);
    fetchTicker(selectedAsset)
      .then((data) => {
        if (active) setTicker(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [selectedAsset]);

  // ONE subscription per selected asset. Depending on `ticker` here caused a
  // self-retriggering loop: every price frame allocated a new ticker object,
  // re-keyed this effect, and subscribeToPriceUpdates fetches immediately on
  // subscribe — so the 5s poll became a continuous serial fetch loop against
  // /api/price for every visitor. The functional updater below already
  // handles the pre-first-fetch (null) case.
  useEffect(() => {
    const unsubscribe = subscribeToPriceUpdates(selectedAsset, (newPrice) => {
      setTicker((prev) => (prev ? { ...prev, price: newPrice } : prev));
    });
    return unsubscribe;
  }, [selectedAsset]);

  const markPrice = markPrices[selectedAsset] || 0;
  const displayPrice = markPrice > 0 ? markPrice : ticker?.price ?? 0;

  // Flash on the displayed price's movement so the flash matches the number.
  const lastDisplayRef = useRef(displayPrice);
  useEffect(() => {
    const prev = lastDisplayRef.current;
    if (displayPrice > prev) setPriceFlash('up');
    else if (displayPrice < prev) setPriceFlash('down');
    lastDisplayRef.current = displayPrice;
    const t = setTimeout(() => setPriceFlash(null), 200);
    return () => clearTimeout(t);
  }, [displayPrice]);

  const change = ticker?.changePercent24h ?? null;

  // L1-13: long/short split of open interest. Prefer the chain AssetExposure
  // pair carried in `capacity` (the vault's exact inputs) over the indexer
  // projection so the split and the order panel's headroom agree.
  const oiLongUsd = assetStats ? statToUsd(assetStats.capacity?.oiLong ?? assetStats.openInterestLong) : 0;
  const oiShortUsd = assetStats ? statToUsd(assetStats.capacity?.oiShort ?? assetStats.openInterestShort) : 0;
  const oiTotalUsd = oiLongUsd + oiShortUsd;
  const longPct = oiTotalUsd > 0 ? Math.round((oiLongUsd / oiTotalUsd) * 100) : null;
  const skewTooltip = (() => {
    const cap = assetStats?.capacity;
    if (!cap) return 'Share of open interest on each side.';
    const net = statToUsd(cap.netSkew);
    const skewCap = statToUsd(cap.skewCap);
    const used = skewCap > 0 ? Math.round((Math.abs(net) / skewCap) * 100) : null;
    const netStr = `${net < 0 ? '−' : '+'}${formatCompactUsd(Math.abs(net))}`;
    return `Net skew ${netStr} of ${formatCompactUsd(skewCap)} cap${used != null ? ` (${used}% used)` : ''}. Past the cap, only orders that reduce the skew go through (#89).`;
  })();

  return (
    <div className="border-b border-border bg-background">
      <div className="flex items-center gap-4 lg:gap-5 px-3 sm:px-4 h-14 overflow-x-auto scrollbar-none">
        <AssetSelectorDropdown
          selectedAsset={selectedAsset}
          onSelect={onSelect}
          markPrices={markPrices}
        />

        <div className="h-6 w-px bg-border shrink-0" aria-hidden="true" />

        {/* Mark price — the number the venue executes against */}
        <span
          className={cn(
            'text-base font-mono font-medium tabular-nums shrink-0 transition-colors duration-200',
            priceFlash === 'up' && 'text-long',
            priceFlash === 'down' && 'text-short',
            !priceFlash && 'text-foreground'
          )}
        >
          {displayPrice > 0 ? formatUSD(displayPrice, priceDecimals(selectedAsset)) : '—'}
        </span>

        {pricesStale && (
          <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded-sm bg-primary/10 text-primary border border-primary/25 whitespace-nowrap">
            Live prices stale
          </span>
        )}

        <Stat label="24h Change">
          {change == null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className={change > 0 ? 'text-long' : change < 0 ? 'text-short' : undefined}>
              {formatPercent(change)}
            </span>
          )}
        </Stat>

        <Stat label="24h High">
          {ticker ? formatUSD(ticker.high24h, priceDecimals(selectedAsset)) : '—'}
        </Stat>

        <Stat label="24h Low">
          {ticker ? formatUSD(ticker.low24h, priceDecimals(selectedAsset)) : '—'}
        </Stat>

        {/* Binance reference stat — distinct from the venue's own volume (A16). */}
        <Stat label="24h Vol (Binance)" className="hidden md:block">
          {ticker ? `$${formatNumber(ticker.volume24h / 1_000_000, 2)}M` : '—'}
        </Stat>

        <Stat label="Open Interest">
          {assetStats
            ? formatCompactUsd(
                statToUsd(assetStats.openInterestLong) + statToUsd(assetStats.openInterestShort),
              )
            : '—'}
        </Stat>

        <Stat
          label={
            <Tooltip content={skewTooltip}>
              <span className="cursor-help border-b border-dotted border-faint">Long / Short</span>
            </Tooltip>
          }
        >
          {longPct == null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <>
              <span className="text-long">{longPct}%</span>
              <span className="text-faint"> / </span>
              <span className="text-short">{100 - longPct}%</span>
            </>
          )}
        </Stat>

        <Stat label="24h Vol (Noether)">
          {assetStats ? formatCompactUsd(statToUsd(assetStats.volume24h)) : '—'}
        </Stat>

        <Stat
          label={
            <Tooltip content="Positive: longs pay shorts; negative: shorts pay longs. Accrues hourly and is settled when a position closes or is liquidated.">
              <span className="cursor-help border-b border-dotted border-faint">Funding / 1h</span>
            </Tooltip>
          }
        >
          <span
            className={cn(
              fundingRate === null
                ? 'text-muted-foreground'
                : Number(fundingRate.toFixed(4)) === 0
                ? undefined
                : fundingRate > 0
                ? 'text-long'
                : 'text-short',
            )}
          >
            {fundingRate === null ? '—' : formatPercent(fundingRate, 4)}
          </span>
        </Stat>
      </div>
    </div>
  );
}
