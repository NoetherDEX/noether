"use client"

import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { Share2, X, TrendingUp, AlertTriangle, Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react"
import { useWalletContext } from "@/components/providers/wallet-provider"
import { useMarket, Position } from "@/hooks/useMarket"
import { usePrice } from "@/hooks/usePrice"
import { toast } from "sonner"

type TabType = "positions" | "orders" | "history"

interface DisplayPosition {
  market: string
  side: "long" | "short"
  sizeToken: number
  sizeUsd: number
  netValue: number
  entryPrice: number
  markPrice: number
  liqPrice: number
  pnl: number
  pnlPercent: number
  leverage: number
  asset?: "Stellar" | "USDC"
  isReal?: boolean
}

interface Order {
  market: string
  side: "buy" | "sell"
  type: string
  size: number
  price: number
  filled: number
  status: string
}

interface HistoryItem {
  market: string
  side: "buy" | "sell"
  size: number
  price: number
  pnl: number
  time: string
}

// Demo positions for non-connected users
const demoPositions: DisplayPosition[] = [
  {
    market: "BTC-PERP",
    side: "long",
    sizeToken: 0.5,
    sizeUsd: 49210,
    netValue: 50170,
    entryPrice: 96500,
    markPrice: 98420,
    liqPrice: 87250,
    pnl: 960,
    pnlPercent: 1.99,
    leverage: 10,
    isReal: false,
  },
  {
    market: "ETH-PERP",
    side: "short",
    sizeToken: 2.5,
    sizeUsd: 9617.5,
    netValue: 9800,
    entryPrice: 3920,
    markPrice: 3847,
    liqPrice: 4180,
    pnl: 182.5,
    pnlPercent: 1.86,
    leverage: 5,
    isReal: false,
  },
  {
    market: "XLM-PERP",
    side: "long",
    sizeToken: 25000,
    sizeUsd: 11250,
    netValue: 11520,
    entryPrice: 0.438,
    markPrice: 0.45,
    liqPrice: 0.415,
    pnl: 300,
    pnlPercent: 2.74,
    leverage: 8,
    isReal: false,
  },
]

export function PositionsTabs() {
  const { isConnected, address } = useWalletContext()
  const {
    closePosition,
    isLoading: isClosing,
    positions: contractPositions,
    currentPrices,
    refreshPositions,
    refreshPrices
  } = useMarket()
  const { currentPrice: xlmPrice } = usePrice("stellar")

  const [activeTab, setActiveTab] = useState<TabType>("positions")
  const [showDemoData, setShowDemoData] = useState(true)
  const [closingPositionIndex, setClosingPositionIndex] = useState<number | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Convert contract positions to display format
  const realPositions: DisplayPosition[] = contractPositions.map((pos) => {
    const markPrice = pos.asset === "Stellar"
      ? (xlmPrice?.price || currentPrices.stellar || 0.45)
      : currentPrices.usdc || 1

    const pnl = pos.isLong
      ? (markPrice - pos.entryPrice) * pos.size
      : (pos.entryPrice - markPrice) * pos.size

    const pnlPercent = pos.collateral > 0 ? (pnl / pos.collateral) * 100 : 0
    const leverage = pos.collateral > 0 ? Math.round(pos.size / pos.collateral) : 1

    return {
      market: pos.asset === "Stellar" ? "XLM-PERP" : "USDC-PERP",
      side: pos.isLong ? "long" : "short",
      sizeToken: pos.size,
      sizeUsd: pos.size * markPrice,
      netValue: pos.collateral + pnl,
      entryPrice: pos.entryPrice,
      markPrice,
      liqPrice: pos.liquidationPrice,
      pnl,
      pnlPercent,
      leverage,
      asset: pos.asset,
      isReal: true,
    }
  })

  // Use real positions if connected and have any, otherwise show demo
  const displayPositions = isConnected && realPositions.length > 0
    ? realPositions
    : (showDemoData ? demoPositions : [])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await Promise.all([refreshPositions(), refreshPrices()])
      toast.success("Positions refreshed")
    } catch (err) {
      toast.error("Failed to refresh positions")
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleClosePosition = async (index: number, position: DisplayPosition) => {
    if (!position.isReal || !position.asset) {
      toast.error("Demo positions cannot be closed. Connect wallet to trade.")
      return
    }

    setClosingPositionIndex(index)
    try {
      toast.loading("Closing position...", { id: `close-${index}` })

      const txHash = await closePosition(position.asset)

      if (txHash) {
        toast.success(`Position closed! TX: ${txHash.slice(0, 8)}...`, { id: `close-${index}` })
      } else {
        toast.error("Failed to close position", { id: `close-${index}` })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to close position", { id: `close-${index}` })
    } finally {
      setClosingPositionIndex(null)
    }
  }

  const orders: Order[] = [
    { market: "BTC-PERP", side: "buy", type: "Limit", size: 0.25, price: 97000, filled: 0, status: "Open" },
    { market: "XLM-PERP", side: "sell", type: "Stop", size: 1000, price: 0.44, filled: 0, status: "Open" },
  ]

  const history: HistoryItem[] = [
    { market: "BTC-PERP", side: "buy", size: 0.1, price: 95200, pnl: 322, time: "2h ago" },
    { market: "SOL-PERP", side: "sell", size: 5, price: 238.4, pnl: -45.2, time: "5h ago" },
    { market: "ETH-PERP", side: "buy", size: 1, price: 3650, pnl: 197, time: "1d ago" },
  ]

  const tabs = [
    { id: "positions" as const, label: "Positions", count: displayPositions.length },
    { id: "orders" as const, label: "Open Orders", count: orders.length },
    { id: "history" as const, label: "History", count: null },
  ]

  const isLiquidationRisk = (pos: DisplayPosition) => {
    const diff = Math.abs(pos.liqPrice - pos.markPrice) / pos.markPrice
    return diff < 0.1 // Within 10% of mark price
  }

  const formatPrice = (price: number) => {
    if (price < 1) return `$${price.toFixed(4)}`
    if (price < 100) return `$${price.toFixed(2)}`
    return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const formatTokenSize = (size: number) => {
    if (size >= 1000) return size.toLocaleString(undefined, { maximumFractionDigits: 0 })
    if (size >= 1) return size.toFixed(2)
    return size.toFixed(4)
  }

  return (
    <div className="flex-1 min-h-0 rounded-lg border border-white/10 bg-card overflow-hidden flex flex-col">
      {/* Tabs */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-white/10">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-2",
                activeTab === tab.id
                  ? "bg-gradient-to-r from-[#8b5cf6]/20 to-[#3b82f6]/20 text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5",
              )}
            >
              {tab.label}
              {tab.count !== null && (
                <span
                  className={cn(
                    "px-1.5 py-0.5 text-xs rounded-full font-mono",
                    activeTab === tab.id ? "bg-[#8b5cf6]/30" : "bg-white/10",
                  )}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {/* Connection status indicator */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/5">
            {isConnected ? (
              <>
                <Wifi className="w-3 h-3 text-green-500" />
                <span className="text-[10px] text-green-500">LIVE</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">DEMO</span>
              </>
            )}
          </div>

          {activeTab === "positions" && isConnected && (
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1.5 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
              title="Refresh positions"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")} />
            </button>
          )}

          {activeTab === "positions" && !isConnected && (
            <button
              onClick={() => setShowDemoData(!showDemoData)}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded bg-white/5"
            >
              {showDemoData ? "Hide Demo" : "Show Demo"}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "positions" && (
          <>
            {displayPositions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-16 px-4">
                <div className="relative mb-4">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#8b5cf6]/10 to-[#3b82f6]/10 flex items-center justify-center">
                    <TrendingUp className="w-8 h-8 text-muted-foreground/50" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-card border border-white/10 flex items-center justify-center">
                    <span className="text-muted-foreground/50 text-xs font-mono">0</span>
                  </div>
                </div>
                <h3 className="text-foreground font-medium mb-1">No open positions</h3>
                <p className="text-muted-foreground text-sm text-center max-w-xs">
                  {isConnected
                    ? "Open a position to start trading. Your active trades will appear here."
                    : "Connect your wallet to view your positions or enable demo mode."}
                </p>
                {!isConnected && (
                  <button
                    onClick={() => setShowDemoData(true)}
                    className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] text-white hover:opacity-90 transition-opacity"
                  >
                    Show Demo Positions
                  </button>
                )}
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="text-muted-foreground border-b border-white/5">
                    <th className="text-left px-3 py-2.5 font-medium">Market</th>
                    <th className="text-right px-3 py-2.5 font-medium">Size</th>
                    <th className="text-right px-3 py-2.5 font-medium">Net Value</th>
                    <th className="text-right px-3 py-2.5 font-medium">Entry / Mark</th>
                    <th className="text-right px-3 py-2.5 font-medium">Liq. Price</th>
                    <th className="text-right px-3 py-2.5 font-medium">PnL</th>
                    <th className="text-center px-3 py-2.5 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayPositions.map((pos, i) => (
                    <tr key={i} className={cn(
                      "border-b border-white/5 hover:bg-white/[0.03] transition-colors",
                      !pos.isReal && "opacity-70"
                    )}>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{pos.market}</span>
                          <span
                            className={cn(
                              "px-1.5 py-0.5 rounded text-[10px] font-bold font-mono",
                              pos.side === "long"
                                ? "bg-[#22c55e]/15 text-[#22c55e] ring-1 ring-[#22c55e]/30"
                                : "bg-[#ef4444]/15 text-[#ef4444] ring-1 ring-[#ef4444]/30",
                            )}
                          >
                            {pos.leverage}x
                          </span>
                          {!pos.isReal && (
                            <span className="px-1 py-0.5 rounded text-[8px] font-medium bg-yellow-500/20 text-yellow-500">
                              DEMO
                            </span>
                          )}
                          {pos.isReal && (
                            <span className="px-1 py-0.5 rounded text-[8px] font-medium bg-green-500/20 text-green-500">
                              LIVE
                            </span>
                          )}
                        </div>
                        <span
                          className={cn(
                            "text-[10px] font-medium",
                            pos.side === "long" ? "text-[#22c55e]" : "text-[#ef4444]",
                          )}
                        >
                          {pos.side.toUpperCase()}
                        </span>
                      </td>

                      <td className="px-3 py-3 text-right">
                        <div className="font-mono text-foreground">
                          ${pos.sizeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </div>
                        <div className="font-mono text-muted-foreground text-[10px]">
                          {formatTokenSize(pos.sizeToken)} {pos.market.replace("-PERP", "")}
                        </div>
                      </td>

                      <td className="px-3 py-3 text-right">
                        <span className="font-mono text-foreground">
                          ${pos.netValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      </td>

                      <td className="px-3 py-3 text-right">
                        <div className="font-mono text-muted-foreground text-[10px]">{formatPrice(pos.entryPrice)}</div>
                        <div className="font-mono text-foreground">{formatPrice(pos.markPrice)}</div>
                      </td>

                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isLiquidationRisk(pos) && <AlertTriangle className="w-3 h-3 text-[#f97316]" />}
                          <span
                            className={cn(
                              "font-mono",
                              isLiquidationRisk(pos) ? "text-[#f97316]" : "text-muted-foreground",
                            )}
                          >
                            {formatPrice(pos.liqPrice)}
                          </span>
                        </div>
                      </td>

                      <td className="px-3 py-3 text-right">
                        <div
                          className={cn("font-mono font-medium", pos.pnl >= 0 ? "text-[#22c55e]" : "text-[#ef4444]")}
                        >
                          {pos.pnl >= 0 ? "+" : ""}${Math.abs(pos.pnl).toFixed(2)}
                        </div>
                        <div
                          className={cn(
                            "font-mono text-[10px]",
                            pos.pnl >= 0 ? "text-[#22c55e]/70" : "text-[#ef4444]/70",
                          )}
                        >
                          {pos.pnlPercent >= 0 ? "+" : ""}
                          {pos.pnlPercent.toFixed(2)}%
                        </div>
                      </td>

                      <td className="px-3 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            className="p-1.5 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
                            title="Share Position"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleClosePosition(i, pos)}
                            disabled={closingPositionIndex === i || (!pos.isReal && isConnected)}
                            className="px-2.5 py-1 rounded text-[10px] font-medium bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/20 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                            title={pos.isReal ? "Close Position" : "Demo position - Connect wallet to trade"}
                          >
                            {closingPositionIndex === i ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <X className="w-3 h-3" />
                            )}
                            {closingPositionIndex === i ? "Closing..." : "Close"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {activeTab === "orders" && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="text-muted-foreground border-b border-white/5">
                <th className="text-left px-3 py-2 font-medium">Market</th>
                <th className="text-left px-3 py-2 font-medium">Side</th>
                <th className="text-left px-3 py-2 font-medium">Type</th>
                <th className="text-right px-3 py-2 font-medium">Size</th>
                <th className="text-right px-3 py-2 font-medium">Price</th>
                <th className="text-right px-3 py-2 font-medium">Filled</th>
                <th className="text-right px-3 py-2 font-medium">Status</th>
                <th className="text-right px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2.5 font-medium text-foreground">{order.market}</td>
                  <td className="px-3 py-2.5">
                    <span className={order.side === "buy" ? "text-[#22c55e]" : "text-[#ef4444]"}>
                      {order.side.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{order.type}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-foreground">{order.size}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-foreground">${order.price.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{order.filled}%</td>
                  <td className="px-3 py-2.5 text-right text-foreground">{order.status}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button className="text-muted-foreground hover:text-[#ef4444] transition-colors">Cancel</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {activeTab === "history" && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="text-muted-foreground border-b border-white/5">
                <th className="text-left px-3 py-2 font-medium">Market</th>
                <th className="text-left px-3 py-2 font-medium">Side</th>
                <th className="text-right px-3 py-2 font-medium">Size</th>
                <th className="text-right px-3 py-2 font-medium">Price</th>
                <th className="text-right px-3 py-2 font-medium">Realized PnL</th>
                <th className="text-right px-3 py-2 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2.5 font-medium text-foreground">{item.market}</td>
                  <td className="px-3 py-2.5">
                    <span className={item.side === "buy" ? "text-[#22c55e]" : "text-[#ef4444]"}>
                      {item.side.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-foreground">{item.size}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-foreground">${item.price.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    <span className={item.pnl >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"}>
                      {item.pnl >= 0 ? "+" : ""}${item.pnl.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground">{item.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
