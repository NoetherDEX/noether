"use client"

import { ArrowUpRight, ArrowDownRight, Wallet, TrendingUp, Shield, Download, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"

export function PortfolioAccountHealth() {
  const unrealizedPnl = 1200.45
  const isPnlPositive = unrealizedPnl > 0
  const marginUsage = 24

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
          <div className="font-mono text-4xl font-bold text-foreground tracking-tight">$12,450.00</div>
          <div className="flex items-center gap-1 mt-2 text-sm text-[#22c55e]">
            <ArrowUpRight className="h-4 w-4" />
            <span className="font-mono">+8.24%</span>
            <span className="text-muted-foreground ml-1">this month</span>
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
          <span className="font-mono">{isPnlPositive ? "+" : "-"}12.4%</span>
        </div>
      </div>

      {/* Buying Power */}
      <div className="rounded-xl border border-white/10 bg-card p-4 min-w-[160px]">
        <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
          <Shield className="h-3.5 w-3.5" />
          <span>Buying Power</span>
        </div>
        <div className="font-mono text-xl font-bold text-foreground">$9,420.00</div>
        <div className="text-xs text-muted-foreground mt-1">Available to trade</div>
      </div>

      {/* Margin Usage */}
      <div className="rounded-xl border border-white/10 bg-card p-4 min-w-[180px]">
        <div className="flex items-center justify-between text-muted-foreground text-xs mb-2">
          <span>Margin Usage</span>
          <span className="font-mono text-foreground">{marginUsage}%</span>
        </div>
        <Progress
          value={marginUsage}
          className="h-2 bg-secondary [&>div]:bg-gradient-to-r [&>div]:from-[#22c55e] [&>div]:to-[#3b82f6]"
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-2">
          <span>Safe</span>
          <span>$2,980 / $12,450</span>
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
