"use client"

import { useState, useEffect } from "react"
import { XAxis, YAxis, ResponsiveContainer, Tooltip, Area, AreaChart } from "recharts"
import { ChartContainer } from "@/components/ui/chart"
import { TrendingUp } from "lucide-react"

const timeframes = ["1D", "1W", "1M", "All"] as const
type Timeframe = (typeof timeframes)[number]

type DataPoint = { time: string; pnl: number }

// Generate realistic PnL data (seeded for consistency)
const generateData = (timeframe: Timeframe, seed: number): DataPoint[] => {
  const points = timeframe === "1D" ? 24 : timeframe === "1W" ? 7 : timeframe === "1M" ? 30 : 90
  const data: DataPoint[] = []
  let value = 10000

  // Simple seeded random for consistency
  const seededRandom = (i: number) => {
    const x = Math.sin(seed + i * 9999) * 10000
    return x - Math.floor(x)
  }

  for (let i = 0; i < points; i++) {
    const change = (seededRandom(i) - 0.45) * 300
    value = Math.max(8000, value + change)

    let label = ""
    if (timeframe === "1D") {
      label = `${i}:00`
    } else if (timeframe === "1W") {
      const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      label = days[i % 7]
    } else if (timeframe === "1M") {
      label = `${i + 1}`
    } else {
      label = `${Math.floor(i / 30) + 1}M`
    }

    data.push({
      time: label,
      pnl: Math.round(value * 100) / 100,
    })
  }
  return data
}

export function PortfolioPnlChart() {
  const [timeframe, setTimeframe] = useState<Timeframe>("1M")
  const [data, setData] = useState<DataPoint[]>([])
  const [mounted, setMounted] = useState(false)

  // Generate data only on client side to avoid hydration mismatch
  useEffect(() => {
    setMounted(true)
    // Use a fixed seed based on timeframe for consistent rendering
    const seed = timeframe === "1D" ? 1 : timeframe === "1W" ? 2 : timeframe === "1M" ? 3 : 4
    setData(generateData(timeframe, seed))
  }, [timeframe])
  const startValue = data[0]?.pnl || 10000
  const endValue = data[data.length - 1]?.pnl || 10000
  const change = endValue - startValue
  const changePercent = startValue > 0 ? ((change / startValue) * 100).toFixed(2) : "0.00"
  const isPositive = change >= 0

  // Show loading skeleton during SSR/initial mount
  if (!mounted) {
    return (
      <div className="rounded-xl border border-white/10 bg-card p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-[#8b5cf6]" />
              <span className="font-semibold text-foreground">PnL History</span>
            </div>
            <div className="flex items-center gap-2 pl-3 border-l border-white/10">
              <span className="font-mono text-lg font-bold text-muted-foreground">--</span>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-secondary/50 rounded-lg p-1">
            {timeframes.map((tf) => (
              <button
                key={tf}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                  timeframe === tf ? "bg-[#8b5cf6] text-white" : "text-muted-foreground"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[280px] w-full flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading chart...</div>
        </div>
      </div>
    )
  }

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
            <span className={`font-mono text-lg font-bold ${isPositive ? "text-[#22c55e]" : "text-[#ef4444]"}`}>
              {isPositive ? "+" : "-"}${Math.abs(change).toFixed(2)}
            </span>
            <span className={`text-sm font-mono ${isPositive ? "text-[#22c55e]" : "text-[#ef4444]"}`}>
              ({isPositive ? "+" : ""}
              {changePercent}%)
            </span>
          </div>
        </div>

        {/* Timeframe Selector */}
        <div className="flex items-center gap-1 bg-secondary/50 rounded-lg p-1">
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                timeframe === tf ? "bg-[#8b5cf6] text-white" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <ChartContainer
        config={{
          pnl: {
            label: "PnL",
            color: "#22c55e",
          },
        }}
        className="h-[280px] w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#666", fontSize: 10 }}
              interval="preserveStartEnd"
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#666", fontSize: 10 }}
              tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`}
              domain={["dataMin - 500", "dataMax + 500"]}
              width={50}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="rounded-lg border border-white/10 bg-[#111] px-3 py-2 shadow-xl">
                      <p className="text-xs text-muted-foreground">{payload[0].payload.time}</p>
                      <p className="font-mono text-sm font-bold text-[#22c55e]">
                        ${payload[0].value?.toLocaleString()}
                      </p>
                    </div>
                  )
                }
                return null
              }}
            />
            <Area type="monotone" dataKey="pnl" stroke="#22c55e" strokeWidth={2} fill="url(#pnlGradient)" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  )
}
