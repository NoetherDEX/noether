"use client"

import { useState, useMemo } from "react"
import { ComposedChart, Bar, Area, XAxis, YAxis, ResponsiveContainer, Cell, ReferenceLine, Tooltip } from "recharts"

// Generate 60 realistic BTC price data points around $98,000
const generateBTCData = () => {
  const data = []
  let price = 98000
  const now = new Date()

  for (let i = 0; i < 60; i++) {
    const change = (Math.random() - 0.48) * 150
    const open = price
    const close = price + change
    const high = Math.max(open, close) + Math.random() * 80
    const low = Math.min(open, close) - Math.random() * 80
    const volume = Math.floor(Math.random() * 500 + 100)

    const time = new Date(now.getTime() - (60 - i) * 15 * 60 * 1000)
    const timeLabel = `${time.getHours().toString().padStart(2, "0")}:${time.getMinutes().toString().padStart(2, "0")}`

    data.push({
      time: timeLabel,
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: Math.round(close * 100) / 100,
      volume,
      isGreen: close >= open,
    })
    price = close
  }
  return data
}

interface CustomCursorProps {
  points?: { x: number; y: number }[]
  width?: number
  height?: number
  payload?: { payload: DataPoint }[]
}

const CustomCursor = ({ points, width, height, payload }: CustomCursorProps) => {
  if (!points || !points[0] || !payload || !payload[0]) return null

  const { x, y } = points[0]
  const activeData = payload[0].payload

  return (
    <g>
      {/* Vertical Line (Dashed) */}
      <line x1={x} y1={0} x2={x} y2={height} stroke="#fff" strokeDasharray="3 3" opacity={0.4} />

      {/* Horizontal Line (Dashed) */}
      <line x1={0} y1={y} x2={width} y2={y} stroke="#fff" strokeDasharray="3 3" opacity={0.4} />

      {/* X-Axis Time Badge (Bottom) */}
      <rect x={x - 25} y={height! + 5} width={50} height={20} fill="#333" rx={4} />
      <text x={x} y={height! + 18} fill="#fff" fontSize={11} textAnchor="middle" fontFamily="monospace">
        {activeData.time}
      </text>

      {/* Y-Axis Price Badge (Right Side) */}
      <rect x={width!} y={y - 10} width={60} height={20} fill="#3b82f6" rx={4} />
      <text x={width! + 30} y={y + 4} fill="#fff" fontSize={11} textAnchor="middle" fontFamily="monospace">
        {activeData.close.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </text>
    </g>
  )
}

interface DataPoint {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  isGreen: boolean
}

interface CursorData {
  open: number
  high: number
  low: number
  close: number
  volume: number
  isGreen: boolean
}

export function InteractiveTradingChart() {
  const data = useMemo(() => generateBTCData(), [])

  const [cursorData, setCursorData] = useState<CursorData | null>(null)

  // Calculate price range for scaling
  const priceRange = useMemo(() => {
    const allHighs = data.map((d) => d.high)
    const allLows = data.map((d) => d.low)
    return {
      min: Math.min(...allLows) - 50,
      max: Math.max(...allHighs) + 50,
    }
  }, [data])

  const maxVolume = useMemo(() => Math.max(...data.map((d) => d.volume)), [data])

  const displayOHLC = cursorData || data[data.length - 1]

  const handleMouseMove = (e: any) => {
    if (e && e.activePayload && e.activePayload.length > 0) {
      const payload = e.activePayload[0].payload
      setCursorData({
        open: payload.open,
        high: payload.high,
        low: payload.low,
        close: payload.close,
        volume: payload.volume,
        isGreen: payload.isGreen,
      })
    }
  }

  const handleMouseLeave = () => {
    setCursorData(null)
  }

  return (
    <div className="w-full h-[500px] bg-[#0a0a0a] rounded-xl border border-white/10 overflow-hidden">
      {/* Header OHLC Info - Now dynamically connected to cursorData */}
      <div className="flex items-center gap-6 px-4 py-3 border-b border-white/10 bg-[#0d0d0d]">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-foreground">BTC-PERP</span>
          <span className="text-xs px-1.5 py-0.5 bg-white/10 rounded text-muted-foreground">15m</span>
        </div>
        <div className="flex items-center gap-4 text-sm font-mono">
          <span className="text-muted-foreground">
            O{" "}
            <span className={displayOHLC.isGreen ? "text-[#22c55e]" : "text-[#ef4444]"}>
              {displayOHLC.open.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </span>
          <span className="text-muted-foreground">
            H{" "}
            <span className="text-[#22c55e]">
              {displayOHLC.high.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </span>
          <span className="text-muted-foreground">
            L{" "}
            <span className="text-[#ef4444]">
              {displayOHLC.low.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </span>
          <span className="text-muted-foreground">
            C{" "}
            <span className={displayOHLC.isGreen ? "text-[#22c55e]" : "text-[#ef4444]"}>
              {displayOHLC.close.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </span>
          <span className="text-muted-foreground">
            Vol <span className="text-foreground">{displayOHLC.volume}</span>
          </span>
        </div>
      </div>

      {/* Chart Container */}
      <div className="relative w-full h-[calc(100%-52px)]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 20, right: 70, left: 10, bottom: 30 }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            {/* Gradient definition for area fill */}
            <defs>
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>

            {/* Y-Axis for Price (Right) */}
            <YAxis
              yAxisId="price"
              orientation="right"
              domain={[priceRange.min, priceRange.max]}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#666", fontSize: 10 }}
              tickFormatter={(value) => value.toLocaleString()}
              width={60}
            />

            {/* Y-Axis for Volume (hidden, used for scaling) */}
            <YAxis yAxisId="volume" orientation="left" domain={[0, maxVolume * 7]} hide />

            {/* X-Axis for Time */}
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#666", fontSize: 10 }}
              interval={9}
            />

            {/* Volume Bars (15% height at bottom) */}
            <Bar yAxisId="volume" dataKey="volume" opacity={0.4}>
              {data.map((entry, index) => (
                <Cell key={`vol-${index}`} fill={entry.isGreen ? "#22c55e" : "#ef4444"} />
              ))}
            </Bar>

            {/* Area chart with gradient */}
            <Area
              yAxisId="price"
              type="monotone"
              dataKey="close"
              stroke="#22c55e"
              strokeWidth={2}
              fill="url(#areaGradient)"
            />

            {/* Current Price Reference Line */}
            <ReferenceLine
              yAxisId="price"
              y={data[data.length - 1].close}
              stroke="#22c55e"
              strokeDasharray="4 2"
              strokeOpacity={0.6}
            />

            <Tooltip content={() => null} cursor={<CustomCursor />} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>

        {/* Current Price Label (always visible) */}
        <div
          className="absolute right-[10px] px-2 py-0.5 bg-[#22c55e] text-white text-xs font-mono rounded-sm pointer-events-none"
          style={{
            top: `${20 + ((priceRange.max - data[data.length - 1].close) / (priceRange.max - priceRange.min)) * 85}%`,
            transform: "translateY(-50%)",
          }}
        >
          {data[data.length - 1].close.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </div>
      </div>
    </div>
  )
}
