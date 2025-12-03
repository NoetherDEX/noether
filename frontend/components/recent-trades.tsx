"use client"

import { useMemo } from "react"

interface Trade {
  price: number
  size: number
  time: string
  side: "buy" | "sell"
}

export function RecentTrades() {
  const trades: Trade[] = useMemo(
    () => [
      { price: 98420, size: 0.1254, time: "14:32:45", side: "buy" },
      { price: 98418, size: 0.0892, time: "14:32:44", side: "sell" },
      { price: 98421, size: 0.2341, time: "14:32:43", side: "buy" },
      { price: 98419, size: 0.5673, time: "14:32:42", side: "buy" },
      { price: 98415, size: 0.1234, time: "14:32:41", side: "sell" },
      { price: 98417, size: 0.3456, time: "14:32:40", side: "sell" },
      { price: 98420, size: 0.0891, time: "14:32:39", side: "buy" },
      { price: 98422, size: 0.1782, time: "14:32:38", side: "buy" },
      { price: 98418, size: 0.4562, time: "14:32:37", side: "sell" },
      { price: 98416, size: 0.2345, time: "14:32:36", side: "sell" },
      { price: 98419, size: 0.5671, time: "14:32:35", side: "buy" },
      { price: 98421, size: 0.1234, time: "14:32:34", side: "buy" },
      { price: 98417, size: 0.3214, time: "14:32:33", side: "sell" },
      { price: 98420, size: 0.0987, time: "14:32:32", side: "buy" },
      { price: 98416, size: 0.4521, time: "14:32:31", side: "sell" },
    ],
    [],
  )

  return (
    <div className="flex-[0.4] min-h-0 rounded-lg border border-white/10 bg-card overflow-hidden flex flex-col">
      <div className="px-2 py-1.5 border-b border-white/10 flex items-center justify-between">
        <h3 className="text-xs font-medium text-foreground">Recent Trades</h3>
        <span className="text-[10px] text-muted-foreground">Live</span>
      </div>

      <div className="grid grid-cols-3 gap-1 px-2 py-1 text-[10px] text-muted-foreground border-b border-white/5">
        <span>Price</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Time</span>
      </div>

      <div className="flex-1 overflow-auto">
        {trades.map((trade, i) => (
          <div
            key={i}
            className="grid grid-cols-3 gap-1 px-2 py-[3px] text-[11px] font-mono hover:bg-white/5 transition-colors"
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
