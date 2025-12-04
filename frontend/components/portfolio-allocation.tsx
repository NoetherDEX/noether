"use client"

import { Wallet, Loader2 } from "lucide-react"
import { useWalletContext } from "@/components/providers/wallet-provider"
import { useBalances } from "@/hooks/useBalances"
import { useMemo } from "react"

// Asset colors
const ASSET_COLORS: Record<string, string> = {
  XLM: "#8b5cf6",
  USDC: "#3b82f6",
  BTC: "#f59e0b",
  ETH: "#627eea",
  DEFAULT: "#6b7280",
}

// Asset descriptions
const ASSET_DESCRIPTIONS: Record<string, string> = {
  XLM: "Native",
  USDC: "Stablecoin",
  BTC: "Collateral",
  ETH: "Collateral",
}

export function PortfolioAllocation() {
  const { isConnected } = useWalletContext()
  const { all, totalUsdValue, isLoading } = useBalances()

  // Calculate allocations from real balances
  const allocations = useMemo(() => {
    if (!all || all.length === 0 || totalUsdValue === 0) return []

    // XLM price approximation (in a real app, fetch from oracle/API)
    const xlmPrice = 0.45

    return all.map((balance) => {
      const isXlm = balance.asset === "XLM"
      const usdValue = isXlm ? balance.balanceNum * xlmPrice : balance.balanceNum
      const percentage = totalUsdValue > 0 ? (usdValue / totalUsdValue) * 100 : 0

      return {
        asset: balance.asset,
        percentage: Math.round(percentage * 10) / 10,
        value: usdValue,
        balance: balance.balanceNum,
        color: ASSET_COLORS[balance.asset] || ASSET_COLORS.DEFAULT,
        description: ASSET_DESCRIPTIONS[balance.asset] || "Asset",
      }
    }).filter(a => a.value > 0.01) // Filter out dust
      .sort((a, b) => b.value - a.value) // Sort by value
  }, [all, totalUsdValue])

  // Not connected state
  if (!isConnected) {
    return (
      <div className="rounded-xl border border-white/10 bg-card p-6 flex flex-col items-center justify-center min-h-[300px]">
        <Wallet className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Connect wallet to view allocation</p>
      </div>
    )
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="rounded-xl border border-white/10 bg-card p-6 flex flex-col items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">Loading balances...</p>
      </div>
    )
  }

  // Empty state
  if (allocations.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-card p-6 flex flex-col items-center justify-center min-h-[300px]">
        <Wallet className="h-10 w-10 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground mb-1">No assets found</p>
        <p className="text-xs text-muted-foreground">Fund your account to see allocation</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-white/10 bg-card p-4 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-[#8b5cf6]" />
          <span className="font-semibold text-foreground">Asset Allocation</span>
        </div>
        <span className="font-mono text-sm text-muted-foreground">
          ${totalUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
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
                className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                style={{ backgroundColor: item.color }}
              >
                {item.asset.charAt(0)}
              </div>
              <div>
                <div className="font-medium text-foreground">{item.asset}</div>
                <div className="text-xs text-muted-foreground">
                  {item.description} · {item.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} {item.asset}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-sm font-semibold text-foreground">
                ${item.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="flex items-center gap-2">
                {/* Mini progress bar */}
                <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.min(item.percentage, 100)}%`, backgroundColor: item.color }}
                  />
                </div>
                <span className="font-mono text-xs text-muted-foreground">{item.percentage.toFixed(1)}%</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Collateral Health */}
      <div className="mt-4 pt-4 border-t border-white/10">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Collateral Health</span>
          <span className={allocations.find(a => a.asset === "USDC" || a.asset === "XLM") ? "text-[#22c55e] font-semibold" : "text-[#f59e0b] font-semibold"}>
            {allocations.length > 0 ? "Good" : "N/A"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {allocations.find(a => a.asset === "USDC")
            ? `Your portfolio has ${allocations.find(a => a.asset === "USDC")?.percentage.toFixed(0)}% in stablecoins.`
            : "Consider adding USDC for trading collateral."
          }
        </p>
      </div>
    </div>
  )
}
