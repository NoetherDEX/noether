'use client';

import { useState, useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { formatPercent } from '@/lib/utils/format';
import type { Trade } from '@/types';

const timeframes = ['1D', '1W', '1M', 'All'] as const;
type Timeframe = (typeof timeframes)[number];

interface PnlChartProps {
  trades?: Trade[];
  /** First-load in progress — renders a skeleton, never a fake flat line. */
  isLoading?: boolean;
  /** Trade-history read failed — renders an error state, never fake data. */
  hasError?: boolean;
}

interface ChartDataPoint {
  time: string;
  pnl: number;
  timestamp: number;
}

// Helper to format date labels
const formatDateLabel = (date: Date, timeframe: Timeframe, index: number): string => {
  if (timeframe === '1D') {
    return date.getHours().toString().padStart(2, '0') + ':00';
  } else if (timeframe === '1W') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[date.getDay()];
  } else if (timeframe === '1M') {
    return `${date.getDate()}/${date.getMonth() + 1}`;
  } else {
    // All time
    return `${date.getDate()}/${date.getMonth() + 1}`;
  }
};

export function PnlChart({ trades = [], isLoading = false, hasError = false }: PnlChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('1M');

  const data = useMemo(() => {
    // No trades = nothing to chart. Never fabricate a flat $0 series —
    // loading/error/empty each render their own honest state below.
    if (!trades || trades.length === 0) return [];

    // 1. Sort trades by time ascending
    const sortedTrades = [...trades].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // 2. Determine time range
    const now = new Date();
    const endTime = now.getTime();
    let startTime = endTime;

    if (timeframe === '1D') startTime = now.getTime() - 24 * 60 * 60 * 1000;
    else if (timeframe === '1W') startTime = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    else if (timeframe === '1M') startTime = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    else startTime = sortedTrades[0].timestamp.getTime(); // All time starts at first trade

    // 3. Create buckets/intervals
    const chartData: ChartDataPoint[] = [];
    const points = timeframe === '1D' ? 24 : timeframe === '1W' ? 14 : timeframe === '1M' ? 30 : 50;
    const interval = (endTime - startTime) / (points - 1);

    // Calculate initial cumulative PnL up to startTime
    let currentCumulativePnl = 0;
    // For 'All', we start at 0. For others, we start with PnL accumulated before the window
    // A15: fee may be null/undefined (unknown until the contract emits it) —
    // skip it in the sum rather than assert a $0 charge.
    if (timeframe !== 'All') {
      const tradesBefore = sortedTrades.filter(t => t.timestamp.getTime() < startTime);
      currentCumulativePnl = tradesBefore.reduce((acc, t) => acc + (t.pnl ?? 0) - (t.fee ?? 0), 0);
    }

    // 4. Fill buckets
    let tradeIndex = 0;
    // Skip trades before start time
    while (tradeIndex < sortedTrades.length && sortedTrades[tradeIndex].timestamp.getTime() < startTime) {
      tradeIndex++;
    }

    for (let i = 0; i < points; i++) {
      const bucketTime = startTime + i * interval;

      // Process all trades within this bucket (from previous bucketTime to current bucketTime)
      while (tradeIndex < sortedTrades.length && sortedTrades[tradeIndex].timestamp.getTime() <= bucketTime) {
        const t = sortedTrades[tradeIndex];
        // Add Net PnL (Gross PnL - Fees); an unknown fee is skipped, not zero-asserted (A15)
        const netPnl = (t.pnl ?? 0) - (t.fee ?? 0);
        currentCumulativePnl += netPnl;
        tradeIndex++;
      }

      chartData.push({
        time: formatDateLabel(new Date(bucketTime), timeframe, i),
        pnl: currentCumulativePnl,
        timestamp: bucketTime
      });
    }

    return chartData;
  }, [trades, timeframe]);

  const hasData = data.length > 0;
  const startValue = data[0]?.pnl || 0;
  const endValue = data[data.length - 1]?.pnl || 0;
  const change = endValue - startValue;
  // Percent change off a $0 baseline is undefined — hide it rather than
  // fabricate a "100.00%" (money-display honesty).
  const changePercent: number | null = startValue !== 0
    ? (change / Math.abs(startValue)) * 100
    : endValue !== 0 ? null : 0;

  const isPositive = change >= 0;

  // Calculate chart dimensions
  const minValue = Math.min(...data.map(d => d.pnl));
  const maxValue = Math.max(...data.map(d => d.pnl));
  const range = maxValue - minValue || 1; // Avoid division by zero
  const padding = range * 0.1 || 10; // Ensure some padding even if range is 0

  // Generate SVG path for the area chart
  const chartWidth = 100;
  const chartHeight = 100;
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * chartWidth;
    // Flip Y axis because SVG 0 is at top
    // Normalize value between 0 and 1, then scale to height
    // (val - min) / (max - min)
    const normalizedY = (d.pnl - (minValue - padding)) / ((maxValue + padding) - (minValue - padding));
    const y = chartHeight - (normalizedY * chartHeight);
    return { x, y, value: d.pnl, label: d.time };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  // Close the area path
  const areaPath = `${linePath} L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z`;

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-faint" />
            <span className="text-[13px] font-medium text-foreground">PnL History</span>
          </div>
          {hasData ? (
            <div className="flex items-center gap-2 pl-3 border-l border-border">
              <span className={cn(
                'font-mono tabular-nums text-base font-medium',
                isPositive ? 'text-long' : 'text-short'
              )}>
                {isPositive ? '+' : ''}${change.toFixed(2)}
              </span>
              {changePercent !== null && (
                <span className={cn(
                  'text-sm font-mono tabular-nums',
                  isPositive ? 'text-long' : 'text-short'
                )}>
                  ({formatPercent(changePercent)})
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 pl-3 border-l border-border">
              <span className="font-mono tabular-nums text-base font-medium text-muted-foreground">—</span>
            </div>
          )}
        </div>

        {/* Timeframe Selector */}
        <div className="flex items-center gap-1 bg-surface-2 rounded-md p-0.5">
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={cn(
                'px-4 py-1 text-xs font-medium rounded-sm transition-colors',
                timeframe === tf
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Chart — honest states: skeleton while loading, error, teach-the-page
          empty state; the fabricated flat $0 line is gone. */}
      {!hasData ? (
        <div className="h-[280px] w-full flex items-center justify-center">
          {isLoading ? (
            <div className="w-full h-full flex flex-col justify-between py-6" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-3 w-full bg-surface-2 rounded animate-pulse" />
              ))}
            </div>
          ) : hasError ? (
            <div className="text-center px-6">
              <p className="text-sm text-foreground mb-1">Couldn&apos;t load trade history</p>
              <p className="text-xs text-muted-foreground">
                Realized PnL can&apos;t be charted right now — it retries automatically.
              </p>
            </div>
          ) : (
            <div className="text-center px-6">
              <p className="text-sm text-foreground mb-1">No closed trades yet</p>
              <p className="text-xs text-muted-foreground">
                Your realized PnL charts here after your first position close.
              </p>
            </div>
          )}
        </div>
      ) : (
      <div className="h-[280px] w-full relative group">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          preserveAspectRatio="none"
          className="w-full h-full"
        >
          <defs>
            <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isPositive ? '#16C784' : '#EA3943'} stopOpacity={0.18} />
              <stop offset="100%" stopColor={isPositive ? '#16C784' : '#EA3943'} stopOpacity={0} />
            </linearGradient>
          </defs>
          {/* Grid */}
          {[0.25, 0.5, 0.75].map((t) => (
            <line
              key={t}
              x1={0}
              y1={chartHeight * t}
              x2={chartWidth}
              y2={chartHeight * t}
              stroke="rgba(255,255,255,0.04)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* Area */}
          <path
            d={areaPath}
            fill="url(#pnlGradient)"
          />
          {/* Line */}
          <path
            d={linePath}
            fill="none"
            stroke={isPositive ? '#16C784' : '#EA3943'}
            strokeWidth="1.2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Y-axis labels */}
        <div className="absolute left-0 top-0 h-full flex flex-col justify-between text-xs text-muted-foreground font-mono tabular-nums pointer-events-none py-1">
          <span>${(maxValue + padding).toFixed(0)}</span>
          <span>${(minValue - padding).toFixed(0)}</span>
        </div>

        {/* X-axis labels */}
        <div className="absolute bottom-0 left-5 w-full flex justify-between text-xs text-muted-foreground font-mono tabular-nums pointer-events-none px-4">
          <span>{data[0]?.time}</span>
          <span>{data[Math.floor(data.length / 2)]?.time}</span>
          <span>{data[data.length - 1]?.time}</span>
        </div>

        {/* Tooltip Overlay (Simple implementation) */}
        {/* Note: A full interactive tooltip with mouse tracking would require more complex React state/refs.
            For now, we keep the visual simplicity. */}
      </div>
      )}
    </div>
  );
}
