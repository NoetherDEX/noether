'use client';

import { useState, useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { Trade } from '@/types';

const timeframes = ['1D', '1W', '1M', 'All'] as const;
type Timeframe = (typeof timeframes)[number];

interface PnlChartProps {
  trades?: Trade[];
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

export function PnlChart({ trades = [] }: PnlChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('1M');

  const data = useMemo(() => {
    if (!trades || trades.length === 0) {
      // Return flat line at 0 if no trades
      const emptyData: ChartDataPoint[] = [];
      const now = new Date();
      const points = timeframe === '1D' ? 24 : timeframe === '1W' ? 7 : 30;

      for (let i = 0; i < points; i++) {
        const d = new Date(now);
        if (timeframe === '1D') d.setHours(d.getHours() - (points - 1 - i));
        else d.setDate(d.getDate() - (points - 1 - i));

        emptyData.push({
          time: formatDateLabel(d, timeframe, i),
          pnl: 0,
          timestamp: d.getTime()
        });
      }
      return emptyData;
    }

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
    if (timeframe !== 'All') {
      const tradesBefore = sortedTrades.filter(t => t.timestamp.getTime() < startTime);
      currentCumulativePnl = tradesBefore.reduce((acc, t) => acc + (t.pnl || 0) - (t.fee || 0), 0);
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
        // Add Net PnL (Gross PnL - Fees)
        const netPnl = (t.pnl || 0) - (t.fee || 0);
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

  const startValue = data[0]?.pnl || 0;
  const endValue = data[data.length - 1]?.pnl || 0;
  const change = endValue - startValue;
  // If startValue is 0, we can't calculate percentage change normally.
  // If both are 0, it's 0%. If start is 0 and end is != 0, it's 100% (or technically infinity).
  const changePercent = startValue !== 0
    ? ((change / Math.abs(startValue)) * 100).toFixed(2)
    : endValue !== 0 ? '100.00' : '0.00';

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
    <div className="rounded-xl border border-white/10 bg-card p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-[#8b5cf6]" />
            <span className="font-semibold text-foreground">PnL History</span>
          </div>
          <div className="flex items-center gap-2 pl-3 border-l border-white/10">
            <span className={cn(
              'font-mono text-lg font-bold',
              isPositive ? 'text-[#22c55e]' : 'text-[#ef4444]'
            )}>
              {isPositive ? '+' : ''}${change.toFixed(2)}
            </span>
            <span className={cn(
              'text-sm font-mono',
              isPositive ? 'text-[#22c55e]' : 'text-[#ef4444]'
            )}>
              ({isPositive ? '+' : ''}{changePercent}%)
            </span>
          </div>
        </div>

        {/* Timeframe Selector */}
        <div className="flex items-center gap-1 bg-secondary/50 rounded-lg p-1">
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={cn(
                'px-5 py-1 text-xs font-medium rounded-md transition-all',
                timeframe === tf
                  ? 'bg-[#8b5cf6] text-white'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="h-[280px] w-full relative group">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          preserveAspectRatio="none"
          className="w-full h-full"
        >
          <defs>
            <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isPositive ? '#22c55e' : '#ef4444'} stopOpacity={0.3} />
              <stop offset="100%" stopColor={isPositive ? '#22c55e' : '#ef4444'} stopOpacity={0} />
            </linearGradient>
          </defs>
          {/* Area */}
          <path
            d={areaPath}
            fill="url(#pnlGradient)"
            className="transition-all duration-300 ease-in-out"
          />
          {/* Line */}
          <path
            d={linePath}
            fill="none"
            stroke={isPositive ? '#22c55e' : '#ef4444'}
            strokeWidth="1.2"
            vectorEffect="non-scaling-stroke"
            className="transition-all duration-300 ease-in-out"
          />
        </svg>

        {/* Y-axis labels */}
        <div className="absolute left-0 top-0 h-full flex flex-col justify-between text-xs text-muted-foreground font-mono pointer-events-none py-1">
          <span>${(maxValue + padding).toFixed(0)}</span>
          <span>${(minValue - padding).toFixed(0)}</span>
        </div>

        {/* X-axis labels */}
        <div className="absolute bottom-0 left-5 w-full flex justify-between text-xs text-muted-foreground font-mono pointer-events-none px-4">
          <span>{data[0]?.time}</span>
          <span>{data[Math.floor(data.length / 2)]?.time}</span>
          <span>{data[data.length - 1]?.time}</span>
        </div>

        {/* Tooltip Overlay (Simple implementation) */}
        {/* Note: A full interactive tooltip with mouse tracking would require more complex React state/refs.
            For now, we keep the visual simplicity. */}
      </div>
    </div>
  );
}
