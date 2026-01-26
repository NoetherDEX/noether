'use client';

import { useState, useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const timeframes = ['1D', '1W', '1M', 'All'] as const;
type Timeframe = (typeof timeframes)[number];

interface PnlChartProps {
  historicalData?: { date: Date; value: number }[];
}

// Generate sample PnL data for visualization
const generateData = (timeframe: Timeframe, baseValue: number = 10000) => {
  const points = timeframe === '1D' ? 24 : timeframe === '1W' ? 7 : timeframe === '1M' ? 30 : 90;
  const data = [];
  let value = baseValue;

  for (let i = 0; i < points; i++) {
    // Create volatility with general trend
    const change = (Math.random() - 0.45) * (baseValue * 0.03);
    value = Math.max(baseValue * 0.8, value + change);

    let label = '';
    if (timeframe === '1D') {
      label = `${i}:00`;
    } else if (timeframe === '1W') {
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      label = days[i % 7];
    } else if (timeframe === '1M') {
      label = `${i + 1}`;
    } else {
      label = `${Math.floor(i / 30) + 1}M`;
    }

    data.push({
      time: label,
      pnl: Math.round(value * 100) / 100,
    });
  }
  return data;
};

export function PnlChart({ historicalData }: PnlChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('1M');

  const data = useMemo(() => generateData(timeframe), [timeframe]);
  const startValue = data[0]?.pnl || 0;
  const endValue = data[data.length - 1]?.pnl || 0;
  const change = endValue - startValue;
  const changePercent = startValue > 0 ? ((change / startValue) * 100).toFixed(2) : '0';
  const isPositive = change >= 0;

  // Calculate chart dimensions
  const minValue = Math.min(...data.map(d => d.pnl));
  const maxValue = Math.max(...data.map(d => d.pnl));
  const range = maxValue - minValue || 1;
  const padding = range * 0.1;

  // Generate SVG path for the area chart
  const chartWidth = 100;
  const chartHeight = 100;
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * chartWidth;
    const y = chartHeight - ((d.pnl - minValue + padding) / (range + padding * 2)) * chartHeight;
    return { x, y, value: d.pnl, label: d.time };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
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
              {isPositive ? '+' : '-'}${Math.abs(change).toFixed(2)}
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
                'px-3 py-1 text-xs font-medium rounded-md transition-all',
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
      <div className="h-[280px] w-full relative">
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
          />
          {/* Line */}
          <path
            d={linePath}
            fill="none"
            stroke={isPositive ? '#22c55e' : '#ef4444'}
            strokeWidth="0.5"
          />
        </svg>

        {/* Y-axis labels */}
        <div className="absolute left-0 top-0 h-full flex flex-col justify-between text-xs text-muted-foreground font-mono pointer-events-none">
          <span>${((maxValue + padding) / 1000).toFixed(1)}k</span>
          <span>${((minValue - padding) / 1000).toFixed(1)}k</span>
        </div>

        {/* X-axis labels */}
        <div className="absolute bottom-0 left-0 w-full flex justify-between text-xs text-muted-foreground font-mono pointer-events-none px-8">
          <span>{data[0]?.time}</span>
          <span>{data[Math.floor(data.length / 2)]?.time}</span>
          <span>{data[data.length - 1]?.time}</span>
        </div>
      </div>
    </div>
  );
}
