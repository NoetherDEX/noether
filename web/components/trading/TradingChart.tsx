'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';
import { fetchCandles, toBinanceInterval } from '@/lib/hooks/usePriceData';
import { Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

interface TradingChartProps {
  asset: string;
  interval?: string;
  className?: string;
}

export function TradingChart({ asset, interval = '1h', className }: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const disposedRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    disposedRef.current = false;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#71717a',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: 'rgba(255, 255, 255, 0.2)',
          labelBackgroundColor: '#27272a',
        },
        horzLine: {
          color: 'rgba(255, 255, 255, 0.2)',
          labelBackgroundColor: '#27272a',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: {
        vertTouchDrag: false,
      },
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && !disposedRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      disposedRef.current = true;
      window.removeEventListener('resize', handleResize);
      chartRef.current = null;
      candlestickSeriesRef.current = null;
      chart.remove();
    };
  }, []);

  // Load data when asset or interval changes
  const loadData = useCallback(async () => {
    if (!candlestickSeriesRef.current || disposedRef.current) return;

    setIsLoading(true);
    setError(null);

    try {
      const candles = await fetchCandles(asset, toBinanceInterval(interval));

      if (disposedRef.current || !candlestickSeriesRef.current) return;

      const chartData: CandlestickData<Time>[] = candles.map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      candlestickSeriesRef.current.setData(chartData);
      chartRef.current?.timeScale().fitContent();
    } catch (err) {
      if (!disposedRef.current) {
        setError('Failed to load chart data');
        console.error('Chart data error:', err);
      }
    } finally {
      if (!disposedRef.current) {
        setIsLoading(false);
      }
    }
  }, [asset, interval]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Set up real-time updates
  useEffect(() => {
    if (!candlestickSeriesRef.current || disposedRef.current) return;

    const symbol = asset.toLowerCase();
    const binanceInterval = toBinanceInterval(interval);
    const ws = new WebSocket(
      `wss://stream.binance.us:9443/ws/${symbol}usdt@kline_${binanceInterval}`
    );

    ws.onmessage = (event) => {
      try {
        if (disposedRef.current || !candlestickSeriesRef.current) return;

        const data = JSON.parse(event.data);
        const kline = data.k;

        if (kline) {
          candlestickSeriesRef.current.update({
            time: Math.floor(kline.t / 1000) as Time,
            open: parseFloat(kline.o),
            high: parseFloat(kline.h),
            low: parseFloat(kline.l),
            close: parseFloat(kline.c),
          });
        }
      } catch (err) {
        console.error('WebSocket parse error:', err);
      }
    };

    return () => {
      ws.close();
    };
  }, [asset, interval]);

  return (
    <div className={cn('relative w-full h-full min-h-[400px]', className)}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#09090b]/80 z-10">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            <span className="text-sm text-neutral-400">Loading chart...</span>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#09090b]/80 z-10">
          <div className="text-center">
            <p className="text-red-400 mb-2">{error}</p>
            <button
              onClick={loadData}
              className="text-sm text-neutral-400 hover:text-white underline"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <div ref={chartContainerRef} className="w-full h-full" />
    </div>
  );
}
