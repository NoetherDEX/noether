"use client"

import { useMemo, useEffect, useState } from "react"
import { usePrice } from "@/hooks/usePrice"
import { Loader2, RefreshCw } from "lucide-react"

interface OrderLevel {
  price: number
  size: number
  total: number
}

// Seeded random for consistent order generation
const seededRandom = (seed: number) => {
  const x = Math.sin(seed) * 10000
  return x - Math.floor(x)
}

// Generate order book levels around a current price
const generateOrderLevels = (basePrice: number, isAsk: boolean, count: number = 8): OrderLevel[] => {
  const levels: OrderLevel[] = []
  const spreadMultiplier = 0.0001 // 0.01% spread per level
  const seed = isAsk ? 12345 : 67890

  for (let i = 0; i < count; i++) {
    const priceOffset = basePrice * spreadMultiplier * (i + 1)
    const price = isAsk ? basePrice + priceOffset : basePrice - priceOffset

    // Generate semi-random size based on price level (more volume near current price)
    const randomFactor = seededRandom(seed + i * 100 + Math.floor(basePrice / 100))
    const size = (0.2 + randomFactor * 2.5) / (1 + i * 0.2)
    const total = price * size

    levels.push({
      price: Math.round(price * 100) / 100,
      size: Math.round(size * 10000) / 10000,
      total: Math.round(total * 100) / 100,
    })
  }

  return levels
}

export function OrderBook() {
  const { currentPrice, isLoading, refresh } = usePrice("bitcoin")
  const [isRefreshing, setIsRefreshing] = useState(false)

  const basePrice = currentPrice?.price || 98420

  // Generate order book levels based on current price
  const { asks, bids, spread, spreadPercent, lowestAsk, highestBid } = useMemo(() => {
    const askLevels = generateOrderLevels(basePrice, true, 8)
    const bidLevels = generateOrderLevels(basePrice, false, 8)

    const lowest = askLevels.length > 0 ? Math.min(...askLevels.map(a => a.price)) : basePrice
    const highest = bidLevels.length > 0 ? Math.max(...bidLevels.map(b => b.price)) : basePrice
    const spreadValue = lowest - highest
    const spreadPct = ((spreadValue / lowest) * 100).toFixed(3)

    return {
      asks: askLevels,
      bids: bidLevels,
      spread: spreadValue,
      spreadPercent: spreadPct,
      lowestAsk: lowest,
      highestBid: highest,
    }
  }, [basePrice])

  const maxSize = Math.max(...asks.map((a) => a.size), ...bids.map((b) => b.size), 0.001)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await refresh()
    setIsRefreshing(false)
  }

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      refresh()
    }, 10000)
    return () => clearInterval(interval)
  }, [refresh])

  if (isLoading && !currentPrice) {
    return (
      <div className="flex-[0.6] min-h-0 rounded-lg border border-white/10 bg-card overflow-hidden flex flex-col items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground mt-2">Loading order book...</span>
      </div>
    )
  }

  return (
    <div className="flex-[0.6] min-h-0 rounded-lg border border-white/10 bg-card overflow-hidden flex flex-col">
      <div className="px-2 py-1.5 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium text-foreground">Order Book</h3>
          <span className="text-[10px] text-muted-foreground">BTC-PERP</span>
          <span className="text-[8px] px-1 py-0.5 rounded bg-green-500/20 text-green-500">LIVE</span>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3 h-3 ${isRefreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1 px-2 py-1 text-[10px] text-muted-foreground border-b border-white/5">
        <span>Price (USDC)</span>
        <span className="text-right">Amount (BTC)</span>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col justify-end">
        {[...asks].reverse().map((ask, i) => (
          <div key={i} className="relative grid grid-cols-2 gap-1 px-2 py-[3px] text-[11px] font-mono">
            {/* Depth bar */}
            <div
              className="absolute inset-y-0 right-0 bg-[#ef4444]/15 transition-all"
              style={{ width: `${(ask.size / maxSize) * 100}%` }}
            />
            <span className="relative text-[#ef4444]">{ask.price.toLocaleString()}</span>
            <span className="relative text-right text-foreground/80">{ask.size.toFixed(4)}</span>
          </div>
        ))}
      </div>

      <div className="px-2 py-1.5 border-y border-white/10 bg-secondary/50">
        <div className="flex items-center justify-center gap-2 text-[11px]">
          <span className="font-mono text-foreground font-medium">
            ${basePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/5">
            <svg className="w-3 h-3 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
              />
            </svg>
            <span className="text-muted-foreground">{spreadPercent}%</span>
          </div>
          {currentPrice && (
            <span className={`text-[10px] font-mono ${currentPrice.changePercent24h >= 0 ? "text-green-500" : "text-red-500"}`}>
              {currentPrice.changePercent24h >= 0 ? "+" : ""}{currentPrice.changePercent24h.toFixed(2)}%
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {bids.map((bid, i) => (
          <div key={i} className="relative grid grid-cols-2 gap-1 px-2 py-[3px] text-[11px] font-mono">
            {/* Depth bar */}
            <div
              className="absolute inset-y-0 right-0 bg-[#22c55e]/15 transition-all"
              style={{ width: `${(bid.size / maxSize) * 100}%` }}
            />
            <span className="relative text-[#22c55e]">{bid.price.toLocaleString()}</span>
            <span className="relative text-right text-foreground/80">{bid.size.toFixed(4)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
