"use client"

import { Wallet } from "lucide-react"

const allocations = [
  { asset: "USDC", percentage: 80, value: 9960, color: "#3b82f6" },
  { asset: "XLM", percentage: 15, value: 1867.5, color: "#8b5cf6" },
  { asset: "BTC", percentage: 5, value: 622.5, color: "#f59e0b" },
]

export function PortfolioAllocation() {
  const totalValue = allocations.reduce((sum, a) => sum + a.value, 0)

  return (
    <div className="rounded-xl border border-white/10 bg-card p-4 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-[#8b5cf6]" />
          <span className="font-semibold text-foreground">Asset Allocation</span>
        </div>
        <span className="font-mono text-sm text-muted-foreground">${totalValue.toLocaleString()}</span>
      </div>

      {/* Stacked Bar */}
      <div className="h-3 rounded-full overflow-hidden flex mb-6">
        {allocations.map((item, i) => (
          <div
            key={item.asset}
            className="h-full transition-all"
            style={{
              width: `${item.percentage}%`,
              backgroundColor: item.color,
              marginLeft: i > 0 ? "2px" : 0,
            }}
          />
        ))}
      </div>

      {/* Allocation List */}
      <div className="flex-1 flex flex-col gap-3">
        {allocations.map((item) => (
          <div
            key={item.asset}
            className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-white/5"
          >
            <div className="flex items-center gap-3">
              {/* Asset Icon */}
              <div
                className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-black"
                style={{ backgroundColor: item.color }}
              >
                {item.asset.charAt(0)}
              </div>
              <div>
                <div className="font-medium text-foreground">{item.asset}</div>
                <div className="text-xs text-muted-foreground">
                  {item.asset === "USDC" ? "Stablecoin" : item.asset === "XLM" ? "Native" : "Collateral"}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-sm font-semibold text-foreground">${item.value.toLocaleString()}</div>
              <div className="flex items-center gap-2">
                {/* Mini progress bar */}
                <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${item.percentage}%`, backgroundColor: item.color }}
                  />
                </div>
                <span className="font-mono text-xs text-muted-foreground">{item.percentage}%</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Collateral Health */}
      <div className="mt-4 pt-4 border-t border-white/10">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Collateral Health</span>
          <span className="text-[#22c55e] font-semibold">Excellent</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Your portfolio is well-diversified with 80% stable assets.</p>
      </div>
    </div>
  )
}
