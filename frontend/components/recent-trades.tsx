"use client"

import { useMemo, useEffect, useState } from "react"
import { usePrice } from "@/hooks/usePrice"
import { Loader2 } from "lucide-react"

interface Trade {
  price: number
  size: number
  time: string
  side: "buy" | "sell"
}

// Seeded random for consistent trade generation
const seededRandom = (seed: number) => {
  const x = Math.sin(seed) * 10000
  return x - Math.floor(x)
}

// Generate simulated trades around a base price
const generateTrades = (basePrice: number, count: number = 15): Trade[] => {
  const trades: Trade[] = []
  const now = new Date()

  for (let i = 0; i < count; i++) {
    const seed = basePrice + i * 1000
    const random = seededRandom(seed)

    // Price variation within ±0.05%
    const priceOffset = basePrice * 0.0005 * (random - 0.5) * 2
    const price = basePrice + priceOffset

    // Random size between 0.05 and 0.6
    const size = 0.05 + random * 0.55

    // Time going backwards
    const time = new Date(now.getTime() - i * 1000)
    const timeStr = time.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })

    // Side based on seed
    const side: "buy" | "sell" = seededRandom(seed + 500) > 0.5 ? "buy" : "sell"

    trades.push({
      price: Math.round(price * 100) / 100,
      size: Math.round(size * 10000) / 10000,
      time: timeStr,
      side,
    })
  }

  return trades
}

export function RecentTrades() {
  const { currentPrice, isLoading } = usePrice("bitcoin")
  const [trades, setTrades] = useState<Trade[]>([])
  const [mounted, setMounted] = useState(false)

  const basePrice = currentPrice?.price || 98420

  // Generate initial trades on mount
  useEffect(() => {
    setMounted(true)
    setTrades(generateTrades(basePrice))
  }, [])

  // Update trades when price changes significantly
  useEffect(() => {
    if (mounted && currentPrice?.price) {
      setTrades(generateTrades(currentPrice.price))
    }
  }, [currentPrice?.price, mounted])

  // Simulate new trades coming in
  useEffect(() => {
    if (!mounted) return

    const interval = setInterval(() => {
      setTrades(prev => {
        if (prev.length === 0) return prev

        const now = new Date()
        const basePrice = currentPrice?.price || 98420
        const random = Math.random()

        const newTrade: Trade = {
          price: Math.round((basePrice + basePrice * 0.0005 * (random - 0.5) * 2) * 100) / 100,
          size: Math.round((0.05 + random * 0.55) * 10000) / 10000,
          time: now.toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
          }),
          side: random > 0.5 ? "buy" : "sell",
        }

        return [newTrade, ...prev.slice(0, 14)]
      })
    }, 2000 + Math.random() * 3000) // Random interval 2-5 seconds

    return () => clearInterval(interval)
  }, [mounted, currentPrice?.price])

  if (!mounted) {
    return (
      <div className="flex-[0.4] min-h-0 rounded-lg border border-white/10 bg-card overflow-hidden flex flex-col items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex-[0.4] min-h-0 rounded-lg border border-white/10 bg-card overflow-hidden flex flex-col">
      <div className="px-2 py-1.5 border-b border-white/10 flex items-center justify-between">
        <h3 className="text-xs font-medium text-foreground">Recent Trades</h3>
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <span className="text-[10px] text-green-500">Live</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 px-2 py-1 text-[10px] text-muted-foreground border-b border-white/5">
        <span>Price</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Time</span>
      </div>

      <div className="flex-1 overflow-auto">
        {trades.map((trade, i) => (
          <div
            key={`${trade.time}-${i}`}
            className={`grid grid-cols-3 gap-1 px-2 py-[3px] text-[11px] font-mono hover:bg-white/5 transition-colors ${
              i === 0 ? "animate-pulse bg-white/5" : ""
            }`}
          >
            <span className={trade.side === "buy" ? "text-[#22c55e]" : "text-[#ef4444]"}>
              {trade.price.toLocaleString()}
            </span>
            <span className="text-right text-foreground/80">{trade.size.toFixed(4)}</span>
            <span className="text-right text-muted-foreground">{trade.time}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
