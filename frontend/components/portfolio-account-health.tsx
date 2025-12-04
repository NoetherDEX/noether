"use client"

import { ArrowUpRight, ArrowDownRight, Wallet, TrendingUp, Shield, Download, Upload, Loader2, AlertTriangle, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useWalletContext } from "@/components/providers/wallet-provider"
import { useBalances } from "@/hooks/useBalances"
import { toast } from "sonner"
import { useState } from "react"

export function PortfolioAccountHealth() {
  const { isConnected, connect, network } = useWalletContext()
  const { xlm, usdc, totalUsdValue, isLoading, error, fundWithFriendbot } = useBalances()
  const [isFunding, setIsFunding] = useState(false)

  // Mock unrealized PnL (would come from positions in real implementation)
  const unrealizedPnl = 0
  const isPnlPositive = unrealizedPnl >= 0

  // Calculate buying power (total available for trading)
  const buyingPower = usdc?.balanceNum ?? 0

  // Mock margin usage (would come from open positions)
  const marginUsed = 0
  const marginUsage = totalUsdValue > 0 ? (marginUsed / totalUsdValue) * 100 : 0

  const handleFundWithFriendbot = async () => {
    if (network !== "testnet" && network !== "futurenet") {
      toast.error("Friendbot is only available on testnet/futurenet")
      return
    }

    setIsFunding(true)
    toast.loading("Requesting testnet XLM from Friendbot...", { id: "friendbot" })

    try {
      const success = await fundWithFriendbot()
      if (success) {
        toast.success("Account funded! You received 10,000 XLM", { id: "friendbot" })
      } else {
        toast.error("Friendbot funding failed. Try again.", { id: "friendbot" })
      }
    } catch {
      toast.error("Friendbot funding failed", { id: "friendbot" })
    } finally {
      setIsFunding(false)
    }
  }

  // Not connected state
  if (!isConnected) {
    return (
      <div className="rounded-xl border border-white/10 bg-card p-8 text-center">
        <Wallet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">Connect Your Wallet</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Connect your Freighter wallet to view your portfolio
        </p>
        <Button
          onClick={() => connect()}
          className="bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] text-white"
        >
          Connect Wallet
        </Button>
      </div>
    )
  }

  // Account needs funding state
  if (error && error.includes("not funded")) {
    return (
      <div className="rounded-xl border border-[#f59e0b]/30 bg-[#f59e0b]/5 p-8">
        <div className="flex items-start gap-4">
          <AlertTriangle className="h-8 w-8 text-[#f59e0b] flex-shrink-0" />
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-foreground mb-2">Account Not Funded</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Your Stellar account needs to be funded with XLM to activate it.
              On testnet, you can use Friendbot to get free test tokens.
            </p>
            {(network === "testnet" || network === "futurenet") ? (
              <Button
                onClick={handleFundWithFriendbot}
                disabled={isFunding}
                className="bg-[#f59e0b] hover:bg-[#f59e0b]/90 text-black font-semibold"
              >
                {isFunding ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Funding...
                  </>
                ) : (
                  "Fund with Friendbot (Free)"
                )}
              </Button>
            ) : (
              <a
                href="https://www.stellar.org/lumens"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-[#3b82f6] hover:underline"
              >
                Get XLM <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4">
      {/* Net Worth Card - Large */}
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-[#111] to-[#0a0a0a] p-6">
        <div className="absolute top-0 right-0 h-32 w-32 bg-gradient-to-br from-[#8b5cf6]/10 to-transparent rounded-bl-full" />
        <div className="relative">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
            <Wallet className="h-4 w-4" />
            <span>Net Worth</span>
          </div>
          <div className="font-mono text-4xl font-bold text-foreground tracking-tight">
            {isLoading ? (
              <Loader2 className="h-8 w-8 animate-spin" />
            ) : (
              `$${totalUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            )}
          </div>
          <div className="flex items-center gap-2 mt-2 text-sm">
            <span className="text-muted-foreground">
              {xlm.balance} XLM
              {usdc && ` · ${usdc.balance} USDC`}
            </span>
          </div>
        </div>
      </div>

      {/* Unrealized PnL */}
      <div className="rounded-xl border border-white/10 bg-card p-4 min-w-[160px]">
        <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
          <TrendingUp className="h-3.5 w-3.5" />
          <span>Unrealized PnL</span>
        </div>
        <div className={`font-mono text-xl font-bold ${isPnlPositive ? "text-[#22c55e]" : "text-[#ef4444]"}`}>
          {isPnlPositive ? "+" : "-"}${Math.abs(unrealizedPnl).toFixed(2)}
        </div>
        <div className={`flex items-center gap-1 mt-1 text-xs ${isPnlPositive ? "text-[#22c55e]" : "text-[#ef4444]"}`}>
          {isPnlPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          <span className="font-mono">{isPnlPositive ? "+" : "-"}0.0%</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">No open positions</p>
      </div>

      {/* Buying Power */}
      <div className="rounded-xl border border-white/10 bg-card p-4 min-w-[160px]">
        <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
          <Shield className="h-3.5 w-3.5" />
          <span>Buying Power</span>
        </div>
        <div className="font-mono text-xl font-bold text-foreground">
          {isLoading ? "..." : `$${buyingPower.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        </div>
        <div className="text-xs text-muted-foreground mt-1">Available to trade</div>
      </div>

      {/* Margin Usage */}
      <div className="rounded-xl border border-white/10 bg-card p-4 min-w-[180px]">
        <div className="flex items-center justify-between text-muted-foreground text-xs mb-2">
          <span>Margin Usage</span>
          <span className="font-mono text-foreground">{marginUsage.toFixed(0)}%</span>
        </div>
        <Progress
          value={marginUsage}
          className="h-2 bg-secondary [&>div]:bg-gradient-to-r [&>div]:from-[#22c55e] [&>div]:to-[#3b82f6]"
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-2">
          <span>{marginUsage < 50 ? "Safe" : marginUsage < 80 ? "Moderate" : "High Risk"}</span>
          <span>${marginUsed.toFixed(2)} / ${totalUsdValue.toFixed(2)}</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-2">
        <Button className="bg-[#22c55e] hover:bg-[#22c55e]/90 text-black font-semibold gap-2 h-12 px-6">
          <Download className="h-4 w-4" />
          Deposit
        </Button>
        <Button
          variant="outline"
          className="border-white/20 hover:bg-white/5 text-foreground gap-2 h-12 px-6 bg-transparent"
        >
          <Upload className="h-4 w-4" />
          Withdraw
        </Button>
      </div>
    </div>
  )
}
