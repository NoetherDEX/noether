'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  LineStyle,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import { fetchCandles, toBinanceInterval } from '@/lib/hooks/usePriceData';
import { formatUSD, priceDecimals } from '@/lib/utils';
import { cn } from '@/lib/utils/cn';
import { CHART_COLORS, baseChartOptions } from '@/lib/chart/theme';
import { getCandles, type CandleSource } from '@/lib/api/candles';
import { bucketStartSec } from '@/lib/chart/intervals';
import type { Candle, DisplayOrder, DisplayPosition } from '@/types';

export type ChartType = 'candles' | 'line' | 'area';

interface TradingChartProps {
  asset: string;
  interval?: string;
  chartType?: ChartType;
  /** Live Noeracle mark price (the protocol's execution source). Drawn gold. */
  markPrice?: number;
  /** Mark stream stale — the mark line dims + dashes. */
  stale?: boolean;
  /** Open positions for THIS asset — entry + liquidation overlays. */
  positions?: DisplayPosition[];
  /** Pending orders for THIS asset — trigger/limit overlays. */
  orders?: DisplayOrder[];
  /** Reports which source served the candles (native Noeracle vs Binance fallback). */
  onSource?: (source: CandleSource) => void;
  className?: string;
}

/** Legend row — candle series carries OHLC; line/area only a close value. */
interface Bar {
  open?: number;
  high?: number;
  low?: number;
  close: number;
}

// The series type is chosen at runtime (candles/line/area), so the ref is
// intentionally type-erased — each branch feeds it the matching data shape.
type AnySeries = ISeriesApi<any>;

const ORDER_LABELS: Record<DisplayOrder['orderType'], string> = {
  LimitEntry: 'Limit',
  StopLoss: 'SL',
  TakeProfit: 'TP',
  StopLimit: 'Stop-Limit',
  TrailingStop: 'Trail',
};

function toBar(c: Candle, type: ChartType): Bar {
  return type === 'candles'
    ? { open: c.open, high: c.high, low: c.low, close: c.close }
    : { close: c.close };
}

function setSeriesData(series: AnySeries, candles: Candle[], type: ChartType): void {
  if (type === 'candles') {
    series.setData(
      candles.map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
  } else {
    series.setData(candles.map((c) => ({ time: c.time as Time, value: c.close })));
  }
}

function updateSeriesPoint(series: AnySeries, c: Candle, type: ChartType): void {
  if (type === 'candles') {
    series.update({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close });
  } else {
    series.update({ time: c.time as Time, value: c.close });
  }
}

export function TradingChart({
  asset,
  interval = '1h',
  chartType = 'candles',
  markPrice = 0,
  stale = false,
  positions = [],
  orders = [],
  onSource,
  className,
}: TradingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<AnySeries | null>(null);
  const markLineRef = useRef<IPriceLine | null>(null);
  const overlayRef = useRef<IPriceLine[]>([]);
  const liveBarRef = useRef<Candle | null>(null);
  const onSourceRef = useRef(onSource);
  onSourceRef.current = onSource;
  const disposedRef = useRef(false);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<Bar | null>(null);
  const [latest, setLatest] = useState<Bar | null>(null);
  // Bumped whenever the series is (re)created so the mark/overlay effects
  // re-attach their price lines to the new series.
  const [seriesEpoch, setSeriesEpoch] = useState(0);

  const dec = priceDecimals(asset);

  // Stable signature of the overlay-relevant fields. `positions` gets a fresh
  // array reference on every price tick (~500ms), but entry/liq prices don't
  // move — so key the overlay effect on the values, not the array identity.
  const overlayKey = useMemo(() => {
    const pos = positions
      .map((p) => `${p.id}:${p.entryPrice}:${p.liquidationPrice}:${p.direction}`)
      .join('|');
    const ord = orders
      .filter((o) => o.status === 'Pending')
      .map((o) => `${o.id}:${o.triggerPrice}:${o.limitPrice}:${o.orderType}`)
      .join('|');
    return `${pos}#${ord}`;
  }, [positions, orders]);

  // 1) Chart lifecycle (once)
  useEffect(() => {
    if (!containerRef.current) return;
    disposedRef.current = false;

    const chart = createChart(containerRef.current, {
      ...baseChartOptions,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });
    chartRef.current = chart;

    const onResize = () => {
      if (containerRef.current && !disposedRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener('resize', onResize);

    const onCrosshair = (param: MouseEventParams) => {
      const series = seriesRef.current;
      if (!series || param.time === undefined || !param.point) {
        setHover(null);
        return;
      }
      const d = param.seriesData.get(series);
      if (!d) {
        setHover(null);
        return;
      }
      if ('close' in d) {
        const c = d as CandlestickData<Time>;
        setHover({ open: c.open, high: c.high, low: c.low, close: c.close });
      } else if ('value' in d) {
        const l = d as LineData<Time>;
        setHover({ close: l.value });
      }
    };
    chart.subscribeCrosshairMove(onCrosshair);

    return () => {
      disposedRef.current = true;
      window.removeEventListener('resize', onResize);
      chart.unsubscribeCrosshairMove(onCrosshair);
      markLineRef.current = null;
      overlayRef.current = [];
      seriesRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
  }, []);

  // 2) (Re)create the series when the chart type changes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (seriesRef.current) {
      try {
        chart.removeSeries(seriesRef.current);
      } catch {
        /* series already disposed */
      }
      seriesRef.current = null;
      markLineRef.current = null;
      overlayRef.current = [];
    }

    if (chartType === 'line') {
      seriesRef.current = chart.addLineSeries({
        color: CHART_COLORS.gold,
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true,
      });
    } else if (chartType === 'area') {
      seriesRef.current = chart.addAreaSeries({
        lineColor: CHART_COLORS.gold,
        topColor: 'rgba(234, 179, 8, 0.28)',
        bottomColor: 'rgba(234, 179, 8, 0.02)',
        lineWidth: 2,
      });
    } else {
      seriesRef.current = chart.addCandlestickSeries({
        upColor: CHART_COLORS.up,
        downColor: CHART_COLORS.down,
        borderUpColor: CHART_COLORS.up,
        borderDownColor: CHART_COLORS.down,
        wickUpColor: CHART_COLORS.up,
        wickDownColor: CHART_COLORS.down,
      });
    }
    setSeriesEpoch((e) => e + 1);
  }, [chartType]);

  // 3) Load history when asset / interval / chartType changes
  const loadData = useCallback(async () => {
    const series = seriesRef.current;
    if (!series || disposedRef.current) return;
    setIsLoading(true);
    setError(null);
    liveBarRef.current = null; // rebuild the forming bar for the new context
    try {
      let candles: Candle[];
      let source: CandleSource;
      try {
        const native = await getCandles(asset, interval, 500);
        if (native.candles.length === 0) throw new Error('empty');
        candles = native.candles;
        source = native.source;
      } catch {
        // Gateway unreachable / route not deployed / empty → direct Binance proxy.
        candles = await fetchCandles(asset, toBinanceInterval(interval));
        source = 'binance';
      }
      if (disposedRef.current || seriesRef.current !== series) return;
      setSeriesData(series, candles, chartType);
      const last = candles[candles.length - 1];
      setLatest(last ? toBar(last, chartType) : null);
      liveBarRef.current = last ? { ...last } : null;
      chartRef.current?.timeScale().fitContent();
      onSourceRef.current?.(source);
    } catch (err) {
      if (!disposedRef.current) {
        setError('Failed to load chart data');
        console.error('Chart data error:', err);
      }
    } finally {
      if (!disposedRef.current) setIsLoading(false);
    }
  }, [asset, interval, chartType]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 4) Live forming candle — fold the SSE Noeracle mark into the current
  //    bucket. History (closed candles) comes from loadData; the in-progress
  //    bar is built client-side since the backend only persists closed candles.
  useEffect(() => {
    const series = seriesRef.current;
    if (isLoading || !series || !markPrice || markPrice <= 0) return;

    const bucket = bucketStartSec(Math.floor(Date.now() / 1000), interval);
    const prev = liveBarRef.current;
    let bar: Candle;
    if (!prev || bucket > prev.time) {
      bar = { time: bucket, open: markPrice, high: markPrice, low: markPrice, close: markPrice };
    } else if (bucket === prev.time) {
      bar = {
        time: prev.time,
        open: prev.open,
        high: Math.max(prev.high, markPrice),
        low: Math.min(prev.low, markPrice),
        close: markPrice,
      };
    } else {
      return; // out-of-order bucket
    }
    liveBarRef.current = bar;
    updateSeriesPoint(series, bar, chartType);
    setLatest(toBar(bar, chartType));
  }, [markPrice, interval, chartType, seriesEpoch, isLoading]);

  // 5) Live Noeracle mark line — gold, dims + dashes when stale
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    if (!markPrice || markPrice <= 0) {
      if (markLineRef.current) {
        try {
          series.removePriceLine(markLineRef.current);
        } catch {
          /* noop */
        }
        markLineRef.current = null;
      }
      return;
    }

    const opts = {
      price: markPrice,
      color: stale ? CHART_COLORS.goldDim : CHART_COLORS.gold,
      lineWidth: 2 as const,
      lineStyle: stale ? LineStyle.Dashed : LineStyle.Solid,
      axisLabelVisible: true,
      title: stale ? 'Mark (stale)' : 'Mark',
    };
    if (markLineRef.current) {
      markLineRef.current.applyOptions(opts);
    } else {
      markLineRef.current = series.createPriceLine(opts);
    }
  }, [markPrice, stale, seriesEpoch]);

  // 6) Position + pending-order overlays (entry / liquidation / order triggers)
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    for (const line of overlayRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        /* noop */
      }
    }
    overlayRef.current = [];

    for (const p of positions) {
      if (p.entryPrice > 0) {
        overlayRef.current.push(
          series.createPriceLine({
            price: p.entryPrice,
            color: CHART_COLORS.entry,
            lineWidth: 1 as const,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: 'Entry',
          }),
        );
      }
      if (p.liquidationPrice > 0) {
        overlayRef.current.push(
          series.createPriceLine({
            price: p.liquidationPrice,
            color: CHART_COLORS.liq,
            lineWidth: 1 as const,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'Liq',
          }),
        );
      }
    }

    for (const o of orders) {
      if (o.status !== 'Pending') continue;
      const price = o.triggerPrice > 0 ? o.triggerPrice : o.limitPrice;
      if (!price || price <= 0) continue;
      overlayRef.current.push(
        series.createPriceLine({
          price,
          color: CHART_COLORS.order,
          lineWidth: 1 as const,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: ORDER_LABELS[o.orderType] ?? 'Order',
        }),
      );
    }
    // Keyed on overlayKey (stable value signature), not the array identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayKey, seriesEpoch]);

  const shown = hover ?? latest;

  return (
    <div className={cn('relative w-full h-full min-h-[400px]', className)}>
      {/* OHLC / price legend */}
      {shown && (
        <div className="absolute top-2 left-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-mono pointer-events-none select-none">
          <span className="font-semibold text-neutral-200">{asset}/USD</span>
          <span className="text-neutral-500">{interval.toUpperCase()}</span>
          {shown.open !== undefined ? (
            <span className={cn(shown.close >= (shown.open ?? 0) ? 'text-emerald-400' : 'text-red-400')}>
              {`O ${formatUSD(shown.open ?? 0, dec)}  H ${formatUSD(shown.high ?? 0, dec)}  L ${formatUSD(shown.low ?? 0, dec)}  C ${formatUSD(shown.close, dec)}`}
            </span>
          ) : (
            <span className="text-neutral-200">{formatUSD(shown.close, dec)}</span>
          )}
          {markPrice > 0 && (
            <span className={cn(stale ? 'text-amber-500/60' : 'text-amber-400')}>
              {`Mark ${formatUSD(markPrice, dec)}${stale ? ' (stale)' : ''}`}
            </span>
          )}
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#09090b]/80">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            <span className="text-sm text-neutral-400">Loading chart...</span>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#09090b]/80">
          <div className="text-center">
            <p className="mb-2 text-red-400">{error}</p>
            <button onClick={loadData} className="text-sm text-neutral-400 underline hover:text-white">
              Retry
            </button>
          </div>
        </div>
      )}

      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
