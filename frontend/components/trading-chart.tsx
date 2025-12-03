"use client"

import { useState, useMemo } from "react"
import {
  TrendingUp,
  Maximize2,
  CandlestickChart,
  AreaChart,
  BarChart3,
  TrendingDown,
  Pencil,
  Type,
  Ruler,
  Settings,
  Camera,
  X,
  MousePointer,
  Minus,
  ChevronDown,
} from "lucide-react"
import { Button } from "@/components/ui/button"

type ChartMode = "candles" | "area" | "column"

const generatePriceData = () => {
  const data = []
  let price = 141
  for (let i = 0; i < 80; i++) {
    const change = (Math.random() - 0.48) * 3
    const open = price
    const close = price + change
    const high = Math.max(open, close) + Math.random() * 0.8
    const low = Math.min(open, close) - Math.random() * 0.8
    const volume = Math.random() * 700 + 200
    data.push({ open, close, high, low, volume, isGreen: close >= open })
    price = close
  }
  return data
}

function CandlestickChartView({ data }: { data: ReturnType<typeof generatePriceData> }) {
  const chartHeight = 80
  const volumeHeight = 20

  const minPrice = Math.min(...data.map((d) => d.low)) - 1
  const maxPrice = Math.max(...data.map((d) => d.high)) + 1
  const priceRange = maxPrice - minPrice
  const maxVolume = Math.max(...data.map((d) => d.volume))

  const scaleY = (price: number) => ((maxPrice - price) / priceRange) * chartHeight

  return (
    <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
      {[0, 20, 40, 60, 80, 100].map((x) => (
        <line key={`v-${x}`} x1={x} x2={x} y1="0" y2="100" stroke="rgba(255,255,255,0.08)" strokeWidth="0.1" />
      ))}
      {[0, 20, 40, 60, 80].map((y) => (
        <line key={`h-${y}`} x1="0" x2="100" y1={y} y2={y} stroke="rgba(255,255,255,0.08)" strokeWidth="0.1" />
      ))}
      {data.map((candle, i) => {
        const x = (i / data.length) * 100 + 100 / data.length / 2
        const candleWidth = (100 / data.length) * 0.7
        const color = candle.isGreen ? "#14b8a6" : "#f87171"
        const bodyTop = scaleY(Math.max(candle.open, candle.close))
        const bodyBottom = scaleY(Math.min(candle.open, candle.close))
        const bodyHeight = Math.max(bodyBottom - bodyTop, 0.3)
        return (
          <g key={i}>
            <line
              x1={x}
              x2={x}
              y1={scaleY(candle.high)}
              y2={scaleY(candle.low)}
              stroke={color}
              strokeWidth="0.15"
              opacity="0.6"
            />
            <rect
              x={x - candleWidth / 2}
              y={bodyTop}
              width={candleWidth}
              height={bodyHeight}
              fill={color}
              opacity="0.85"
            />
          </g>
        )
      })}
      {data.map((candle, i) => {
        const x = (i / data.length) * 100
        const barWidth = (100 / data.length) * 0.8
        const barHeight = (candle.volume / maxVolume) * volumeHeight
        const color = candle.isGreen ? "#14b8a6" : "#f87171"
        return (
          <rect
            key={`vol-${i}`}
            x={x}
            y={100 - barHeight}
            width={barWidth}
            height={barHeight}
            fill={color}
            opacity="0.4"
          />
        )
      })}
      <line x1="0" x2="100" y1="80" y2="80" stroke="rgba(255,255,255,0.1)" strokeWidth="0.15" />
    </svg>
  )
}

function AreaChartView({ data }: { data: ReturnType<typeof generatePriceData> }) {
  const prices = data.map((d) => d.close)
  const minPrice = Math.min(...prices) - 1
  const maxPrice = Math.max(...prices) + 1
  const range = maxPrice - minPrice
  const points = prices.map((price, i) => ({
    x: (i / (prices.length - 1)) * 100,
    y: ((maxPrice - price) / range) * 100,
  }))
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")
  const areaPath = `${linePath} L 100 100 L 0 100 Z`

  return (
    <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.4" />
          <stop offset="50%" stopColor="#3b82f6" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      {[0, 20, 40, 60, 80, 100].map((x) => (
        <line key={`v-${x}`} x1={x} x2={x} y1="0" y2="100" stroke="rgba(255,255,255,0.08)" strokeWidth="0.1" />
      ))}
      {[0, 20, 40, 60, 80].map((y) => (
        <line key={`h-${y}`} x1="0" x2="100" y1={y} y2={y} stroke="rgba(255,255,255,0.08)" strokeWidth="0.1" />
      ))}
      <path d={areaPath} fill="url(#areaGradient)" />
      <path
        d={linePath}
        fill="none"
        stroke="url(#lineGradient)"
        strokeWidth="0.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={linePath}
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.3"
        filter="blur(2px)"
      />
    </svg>
  )
}

function ColumnChartView({ data }: { data: ReturnType<typeof generatePriceData> }) {
  const prices = data.map((d) => d.close)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const range = maxPrice - minPrice

  return (
    <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
      {[0, 20, 40, 60, 80, 100].map((x) => (
        <line key={`v-${x}`} x1={x} x2={x} y1="0" y2="100" stroke="rgba(255,255,255,0.08)" strokeWidth="0.1" />
      ))}
      {[0, 20, 40, 60, 80].map((y) => (
        <line key={`h-${y}`} x1="0" x2="100" y1={y} y2={y} stroke="rgba(255,255,255,0.08)" strokeWidth="0.1" />
      ))}
      {data.map((candle, i) => {
        const x = (i / data.length) * 100
        const barWidth = (100 / data.length) * 0.8
        const normalizedPrice = ((candle.close - minPrice) / range) * 100
        const color = candle.isGreen ? "#14b8a6" : "#f87171"
        return (
          <rect
            key={i}
            x={x}
            y={100 - normalizedPrice}
            width={barWidth}
            height={normalizedPrice}
            fill={color}
            opacity="0.75"
          />
        )
      })}
    </svg>
  )
}

function FullscreenChart({
  chartMode,
  setChartMode,
  priceData,
  currentOHLC,
  selectedTimeframe,
  setSelectedTimeframe,
  onClose,
}: {
  chartMode: ChartMode
  setChartMode: (mode: ChartMode) => void
  priceData: ReturnType<typeof generatePriceData>
  currentOHLC: { open: string; high: string; low: string; close: string; volume: string }
  selectedTimeframe: string
  setSelectedTimeframe: (tf: string) => void
  onClose: () => void
}) {
  const chartModes: { mode: ChartMode; icon: typeof CandlestickChart; label: string }[] = [
    { mode: "candles", icon: CandlestickChart, label: "Candles" },
    { mode: "area", icon: AreaChart, label: "Area" },
    { mode: "column", icon: BarChart3, label: "Column" },
  ]

  const timeframes = ["1m", "5m", "15m", "1H", "4H", "1D", "1W"]

  const drawingTools = [
    { icon: MousePointer, label: "Cursor" },
    { icon: TrendingUp, label: "Trendline" },
    { icon: TrendingDown, label: "Pitchfork" },
    { icon: Pencil, label: "Draw" },
    { icon: Type, label: "Text" },
    { icon: Ruler, label: "Measure" },
    { icon: Minus, label: "Horizontal Line" },
  ]

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] flex flex-col">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#111111]">
        {/* Left: Market Info */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-foreground">BTC-PERP</span>
            <span className="text-xs px-1.5 py-0.5 bg-white/10 rounded text-muted-foreground">Perpetual</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold font-mono text-foreground">$98,420.00</span>
            <span className="text-sm font-mono text-[#14b8a6]">+2.34%</span>
          </div>
        </div>

        {/* Center: Timeframes */}
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => setSelectedTimeframe(tf)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                tf === selectedTimeframe
                  ? "bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] text-white"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {/* Chart Types */}
          <div className="flex items-center bg-white/5 rounded-md p-0.5 mr-2">
            {chartModes.map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                onClick={() => setChartMode(mode)}
                className={`p-2 rounded transition-all ${
                  chartMode === mode
                    ? "bg-gradient-to-r from-[#8b5cf6]/40 to-[#3b82f6]/40 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title={label}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground gap-1"
          >
            <ChevronDown className="h-3 w-3" />
            Indicators
          </Button>

          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
            <Settings className="h-4 w-4" />
          </Button>

          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
            <Camera className="h-4 w-4" />
          </Button>

          <div className="w-px h-6 bg-white/10 mx-1" />

          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-red-500/20"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Drawing Tools */}
        <div className="w-12 border-r border-white/10 bg-[#0d0d0d] flex flex-col items-center py-3 gap-1">
          {drawingTools.map(({ icon: Icon, label }) => (
            <button
              key={label}
              className="w-9 h-9 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all"
              title={label}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>

        {/* Chart Canvas */}
        <div className="flex-1 relative">
          {/* OHLC Overlay */}
          <div className="absolute top-3 left-3 flex items-center gap-4 text-xs font-mono z-20">
            <span className="text-muted-foreground">
              O <span className="text-[#14b8a6]">{currentOHLC.open}</span>
            </span>
            <span className="text-muted-foreground">
              H <span className="text-[#14b8a6]">{currentOHLC.high}</span>
            </span>
            <span className="text-muted-foreground">
              L <span className="text-[#f87171]">{currentOHLC.low}</span>
            </span>
            <span className="text-muted-foreground">
              C <span className="text-[#14b8a6]">{currentOHLC.close}</span>
            </span>
            <span className="text-muted-foreground">
              Vol <span className="text-foreground">{currentOHLC.volume}K</span>
            </span>
          </div>

          {/* Price Scale */}
          <div className="absolute right-3 top-12 bottom-12 flex flex-col justify-between items-end z-10">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium text-white bg-[#3b82f6] px-1.5 py-0.5 rounded">High</span>
              <span className="text-xs font-mono text-muted-foreground">{currentOHLC.high}</span>
            </div>
            {[144, 142, 140, 138, 136, 134, 132, 130, 128, 126].map((p) => (
              <span key={p} className="text-xs font-mono text-muted-foreground">
                {p}
              </span>
            ))}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium text-white bg-[#3b82f6] px-1.5 py-0.5 rounded">Low</span>
              <span className="text-xs font-mono text-muted-foreground">{currentOHLC.low}</span>
            </div>
          </div>

          {/* Chart */}
          <div className="absolute inset-8 right-20 bottom-8">
            {chartMode === "candles" && <CandlestickChartView data={priceData} />}
            {chartMode === "area" && <AreaChartView data={priceData} />}
            {chartMode === "column" && <ColumnChartView data={priceData} />}
          </div>

          {/* Current Price Line */}
          <div className="absolute left-8 right-20 top-[35%] flex items-center z-10 pointer-events-none">
            <div className="flex-1 border-t border-dashed" style={{ borderColor: "rgba(20, 184, 166, 0.5)" }} />
            <div className="px-2 py-0.5 bg-[#14b8a6] rounded-sm text-xs font-mono text-white ml-1">
              {currentOHLC.close}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function TradingChart() {
  const [chartMode, setChartMode] = useState<ChartMode>("candles")
  const [selectedTimeframe, setSelectedTimeframe] = useState("15m")
  const [isFullscreen, setIsFullscreen] = useState(false)

  const priceData = useMemo(() => generatePriceData(), [])
  const currentOHLC = useMemo(() => {
    const lastCandle = priceData[priceData.length - 1]
    const totalVolume = priceData.reduce((sum, d) => sum + d.volume, 0)
    return {
      open: priceData[0].open.toFixed(2),
      high: Math.max(...priceData.map((d) => d.high)).toFixed(2),
      low: Math.min(...priceData.map((d) => d.low)).toFixed(2),
      close: lastCandle.close.toFixed(2),
      volume: (totalVolume / 1000).toFixed(3),
    }
  }, [priceData])

  const chartModes: { mode: ChartMode; icon: typeof CandlestickChart; label: string }[] = [
    { mode: "candles", icon: CandlestickChart, label: "Candles" },
    { mode: "area", icon: AreaChart, label: "Area" },
    { mode: "column", icon: BarChart3, label: "Column" },
  ]

  const timeframes = ["15m", "1H", "4H", "1D"]

  return (
    <>
      {isFullscreen && (
        <FullscreenChart
          chartMode={chartMode}
          setChartMode={setChartMode}
          priceData={priceData}
          currentOHLC={currentOHLC}
          selectedTimeframe={selectedTimeframe}
          setSelectedTimeframe={setSelectedTimeframe}
          onClose={() => setIsFullscreen(false)}
        />
      )}

      {/* Dashboard View (Compact) */}
      <div className="flex-[1.5] min-h-0 rounded-lg border border-white/10 bg-card overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
          {/* Left: Timeframe Pill Tabs */}
          <div className="flex items-center gap-1 bg-white/5 rounded-full p-0.5">
            {timeframes.map((tf) => (
              <button
                key={tf}
                onClick={() => setSelectedTimeframe(tf)}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${
                  tf === selectedTimeframe
                    ? "bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Right: Chart Type Toggles + Expand */}
          <div className="flex items-center gap-2">
            {/* Chart Type Toggle Group */}
            <div className="flex items-center bg-white/5 rounded-md p-0.5">
              {chartModes.map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  onClick={() => setChartMode(mode)}
                  className={`p-1.5 rounded transition-all ${
                    chartMode === mode
                      ? "bg-gradient-to-r from-[#8b5cf6]/40 to-[#3b82f6]/40 text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title={label}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>

            <button
              onClick={() => setIsFullscreen(true)}
              className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/10 bg-white/5 text-muted-foreground hover:text-foreground hover:border-[#8b5cf6]/50 hover:bg-gradient-to-r hover:from-[#8b5cf6]/10 hover:to-[#3b82f6]/10 transition-all"
              title="Pro Analysis Mode"
            >
              <Maximize2 className="h-3.5 w-3.5 group-hover:scale-110 transition-transform" />
              <span className="text-xs font-medium hidden sm:inline">Expand</span>
            </button>
          </div>
        </div>

        {/* Chart Area */}
        <div className="flex-1 bg-[#0a0a0a] relative overflow-hidden">
          {/* OHLC Data Overlay */}
          <div className="absolute top-2 left-2 flex items-center gap-3 text-xs font-mono z-20 bg-[#0a0a0a]/80 backdrop-blur-sm px-2 py-1 rounded">
            <span className="text-muted-foreground">
              O<span className="text-[#14b8a6] ml-1">{currentOHLC.open}</span>
            </span>
            <span className="text-muted-foreground">
              H<span className="text-[#14b8a6] ml-1">{currentOHLC.high}</span>
            </span>
            <span className="text-muted-foreground">
              L<span className="text-[#f87171] ml-1">{currentOHLC.low}</span>
            </span>
            <span className="text-muted-foreground">
              C<span className="text-[#14b8a6] ml-1">{currentOHLC.close}</span>
            </span>
            <span className="text-muted-foreground">
              Vol<span className="text-foreground ml-1">{currentOHLC.volume}K</span>
            </span>
          </div>

          {chartMode === "candles" && (
            <div className="absolute top-2 left-2 mt-8 text-[10px] font-mono text-muted-foreground z-20">
              Volume <span className="text-[#14b8a6] ml-1">{currentOHLC.volume}K</span>
            </div>
          )}

          {/* Price Scale */}
          <div className="absolute right-2 top-12 bottom-12 flex flex-col justify-between items-end z-10">
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-medium text-white bg-[#3b82f6] px-1.5 py-0.5 rounded">High</span>
              <span className="text-[11px] font-mono text-muted-foreground">{currentOHLC.high}</span>
            </div>
            <span className="text-[11px] font-mono text-muted-foreground">142</span>
            <span className="text-[11px] font-mono text-muted-foreground">140</span>
            <span className="text-[11px] font-mono text-muted-foreground">138</span>
            <span className="text-[11px] font-mono text-muted-foreground">136</span>
            <span className="text-[11px] font-mono text-muted-foreground">134</span>
            <span className="text-[11px] font-mono text-muted-foreground">132</span>
            <span className="text-[11px] font-mono text-muted-foreground">130</span>
            <span className="text-[11px] font-mono text-muted-foreground">128</span>
            <span className="text-[11px] font-mono text-muted-foreground">126</span>
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-medium text-white bg-[#3b82f6] px-1.5 py-0.5 rounded">Low</span>
              <span className="text-[11px] font-mono text-muted-foreground">{currentOHLC.low}</span>
            </div>
          </div>

          {/* Chart Container */}
          <div className="absolute inset-8 right-16 bottom-8">
            {chartMode === "candles" && <CandlestickChartView data={priceData} />}
            {chartMode === "area" && <AreaChartView data={priceData} />}
            {chartMode === "column" && <ColumnChartView data={priceData} />}
          </div>

          {/* Current Price Line */}
          <div className="absolute left-8 right-16 top-[35%] flex items-center z-10 pointer-events-none">
            <div
              className="flex-1 border-t-2 border-dashed"
              style={{ borderColor: "rgba(20, 184, 166, 0.5)", borderWidth: "1px" }}
            />
            <div className="px-2 py-0.5 bg-[#14b8a6] rounded-sm text-[11px] font-mono text-white ml-1">
              {currentOHLC.close}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
