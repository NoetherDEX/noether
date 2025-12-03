"use client"

import { useState } from "react"
import { ArrowUpRight, ArrowDownRight, Download, Filter } from "lucide-react"
import { Button } from "@/components/ui/button"

const tabs = ["Trade History", "Funding Payments", "Transfers"] as const
type Tab = (typeof tabs)[number]

const tradeHistory = [
  {
    id: 1,
    date: "2024-12-02 14:32:18",
    market: "BTC-PERP",
    side: "Long",
    size: "$4,500",
    sizeToken: "0.0457 BTC",
    entryPrice: "$98,420.00",
    exitPrice: "$99,180.00",
    realizedPnl: 345.67,
    fee: 4.5,
  },
  {
    id: 2,
    date: "2024-12-01 09:15:42",
    market: "ETH-PERP",
    side: "Short",
    size: "$2,800",
    sizeToken: "0.728 ETH",
    entryPrice: "$3,847.00",
    exitPrice: "$3,720.00",
    realizedPnl: 232.45,
    fee: 2.8,
  },
  {
    id: 3,
    date: "2024-11-30 22:08:55",
    market: "BTC-PERP",
    side: "Long",
    size: "$6,200",
    sizeToken: "0.063 BTC",
    entryPrice: "$98,100.00",
    exitPrice: "$97,450.00",
    realizedPnl: -408.23,
    fee: 6.2,
  },
  {
    id: 4,
    date: "2024-11-29 16:44:31",
    market: "XLM-PERP",
    side: "Long",
    size: "$1,200",
    sizeToken: "2,654 XLM",
    entryPrice: "$0.4521",
    exitPrice: "$0.4680",
    realizedPnl: 176.89,
    fee: 1.2,
  },
  {
    id: 5,
    date: "2024-11-28 11:22:09",
    market: "ETH-PERP",
    side: "Long",
    size: "$3,500",
    sizeToken: "0.91 ETH",
    entryPrice: "$3,846.00",
    exitPrice: "$3,892.00",
    realizedPnl: 132.45,
    fee: 3.5,
  },
]

const fundingPayments = [
  { id: 1, date: "2024-12-02 08:00:00", market: "BTC-PERP", side: "Long", amount: -12.45, rate: "-0.0100%" },
  { id: 2, date: "2024-12-02 00:00:00", market: "BTC-PERP", side: "Long", amount: -8.32, rate: "-0.0067%" },
  { id: 3, date: "2024-12-01 16:00:00", market: "ETH-PERP", side: "Short", amount: 5.67, rate: "+0.0045%" },
  { id: 4, date: "2024-12-01 08:00:00", market: "BTC-PERP", side: "Long", amount: -15.21, rate: "-0.0122%" },
]

const transfers = [
  { id: 1, date: "2024-12-01 10:00:00", type: "Deposit", asset: "USDC", amount: 5000, txHash: "0x1234...5678" },
  { id: 2, date: "2024-11-28 15:30:00", type: "Withdraw", asset: "USDC", amount: 2000, txHash: "0xabcd...efgh" },
  { id: 3, date: "2024-11-25 09:15:00", type: "Deposit", asset: "XLM", amount: 10000, txHash: "0x9876...5432" },
]

export function PortfolioHistory() {
  const [activeTab, setActiveTab] = useState<Tab>("Trade History")

  return (
    <div className="rounded-xl border border-white/10 bg-card">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        {/* Tabs */}
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === tab
                  ? "bg-[#8b5cf6]/20 text-[#8b5cf6]"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground gap-2">
            <Filter className="h-4 w-4" />
            Filter
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground gap-2">
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto">
        {activeTab === "Trade History" && (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Date</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Market</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Side</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Size</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Entry Price</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Exit Price</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Realized PnL</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Fee</th>
              </tr>
            </thead>
            <tbody>
              {tradeHistory.map((trade) => (
                <tr key={trade.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-muted-foreground">{trade.date}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-foreground text-sm">{trade.market}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-medium ${
                        trade.side === "Long" ? "text-[#22c55e]" : "text-[#ef4444]"
                      }`}
                    >
                      {trade.side === "Long" ? (
                        <ArrowUpRight className="h-3 w-3" />
                      ) : (
                        <ArrowDownRight className="h-3 w-3" />
                      )}
                      {trade.side}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="font-mono text-sm text-foreground">{trade.size}</div>
                    <div className="font-mono text-xs text-muted-foreground">{trade.sizeToken}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono text-sm text-foreground">{trade.entryPrice}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono text-sm text-foreground">{trade.exitPrice}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`font-mono text-sm font-semibold ${
                        trade.realizedPnl >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"
                      }`}
                    >
                      {trade.realizedPnl >= 0 ? "+" : "-"}${Math.abs(trade.realizedPnl).toFixed(2)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono text-xs text-muted-foreground">-${trade.fee.toFixed(2)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {activeTab === "Funding Payments" && (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Date</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Market</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Side</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Rate</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Amount</th>
              </tr>
            </thead>
            <tbody>
              {fundingPayments.map((payment) => (
                <tr key={payment.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-muted-foreground">{payment.date}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-foreground text-sm">{payment.market}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-medium ${payment.side === "Long" ? "text-[#22c55e]" : "text-[#ef4444]"}`}
                    >
                      {payment.side}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono text-xs text-muted-foreground">{payment.rate}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`font-mono text-sm font-semibold ${
                        payment.amount >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"
                      }`}
                    >
                      {payment.amount >= 0 ? "+" : "-"}${Math.abs(payment.amount).toFixed(2)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {activeTab === "Transfers" && (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Date</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Type</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Asset</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Amount</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Tx Hash</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((transfer) => (
                <tr key={transfer.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-muted-foreground">{transfer.date}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded ${
                        transfer.type === "Deposit"
                          ? "bg-[#22c55e]/10 text-[#22c55e]"
                          : "bg-[#ef4444]/10 text-[#ef4444]"
                      }`}
                    >
                      {transfer.type === "Deposit" ? (
                        <ArrowDownRight className="h-3 w-3" />
                      ) : (
                        <ArrowUpRight className="h-3 w-3" />
                      )}
                      {transfer.type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-foreground text-sm">{transfer.asset}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono text-sm text-foreground">
                      {transfer.type === "Deposit" ? "+" : "-"}
                      {transfer.amount.toLocaleString()} {transfer.asset}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <a href="#" className="font-mono text-xs text-[#3b82f6] hover:underline">
                      {transfer.txHash}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
