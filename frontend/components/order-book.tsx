"use client"

import { useMemo } from "react"

interface OrderLevel {
  price: number
  size: number
  total: number
}

export function OrderBook() {
  const asks: OrderLevel[] = useMemo(
    () => [
      { price: 98445, size: 1.234, total: 121469.73 },
      { price: 98442, size: 0.856, total: 84266.35 },
      { price: 98439, size: 2.105, total: 207214.1 },
      { price: 98436, size: 0.523, total: 51482.03 },
      { price: 98433, size: 1.789, total: 176096.64 },
      { price: 98430, size: 0.412, total: 40553.16 },
      { price: 98427, size: 3.201, total: 315064.83 },
      { price: 98424, size: 0.678, total: 66731.47 },
    ],
    [],
  )

  const bids: OrderLevel[] = useMemo(
    () => [
      { price: 98420, size: 2.456, total: 241719.12 },
      { price: 98417, size: 1.123, total: 110522.29 },
      { price: 98414, size: 0.934, total: 91918.68 },
      { price: 98411, size: 1.567, total: 154210.04 },
      { price: 98408, size: 0.789, total: 77643.91 },
      { price: 98405, size: 2.345, total: 230760.73 },
      { price: 98402, size: 0.456, total: 44871.31 },
      { price: 98399, size: 1.89, total: 185974.11 },
    ],
    [],
  )

  const maxSize = Math.max(...asks.map((a) => a.size), ...bids.map((b) => b.size))

  const lowestAsk = Math.min(...asks.map((a) => a.price))
  const highestBid = Math.max(...bids.map((b) => b.price))
  const spread = lowestAsk - highestBid
  const spreadPercent = ((spread / lowestAsk) * 100).toFixed(3)

  return (
    <div className="flex-[0.6] min-h-0 rounded-lg border border-white/10 bg-card overflow-hidden flex flex-col">
      <div className="px-2 py-1.5 border-b border-white/10 flex items-center justify-between">
        <h3 className="text-xs font-medium text-foreground">Order Book</h3>
        <span className="text-[10px] text-muted-foreground">BTC-PERP</span>
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
          <span className="font-mono text-foreground font-medium">${lowestAsk.toLocaleString()}</span>
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
