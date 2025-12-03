"use client"

import { useState } from "react"
import { TopNavbar } from "@/components/top-navbar"
import { OrderBook } from "@/components/order-book"
import { RecentTrades } from "@/components/recent-trades"
import { TradingChart } from "@/components/trading-chart"
import { PositionsTabs } from "@/components/positions-tabs"
import { OrderForm } from "@/components/order-form"
import { cn } from "@/lib/utils"

export default function TradingDashboard() {
  const [viewMode, setViewMode] = useState<"pro" | "basic">("pro")

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      <TopNavbar viewMode={viewMode} onViewModeChange={setViewMode} />

      <main className="flex-1 p-2 pt-0">
        <div
          className={cn(
            "grid gap-2 h-[calc(100vh-64px)] transition-all duration-300 ease-in-out",
            viewMode === "pro" ? "grid-cols-[20%_55%_25%]" : "grid-cols-[0fr_75%_25%]",
          )}
        >
          {/* Left Column - Order Book & Recent Trades */}
          <div
            className={cn(
              "flex flex-col gap-2 min-h-0 transition-all duration-300 ease-in-out overflow-hidden",
              viewMode === "basic" && "opacity-0 pointer-events-none",
            )}
          >
            <OrderBook />
            <RecentTrades />
          </div>

          {/* Middle Column - Chart & Positions */}
          <div className="flex flex-col gap-2 min-h-0 transition-all duration-300 ease-in-out">
            <TradingChart />
            <PositionsTabs />
          </div>

          {/* Right Column - Order Form */}
          <div className="min-h-0">
            <OrderForm />
          </div>
        </div>
      </main>
    </div>
  )
}
