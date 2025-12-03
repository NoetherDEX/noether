"use client"

import { useState } from "react"
import { ArrowDownUp, Info, Shield, Zap, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useWalletContext } from "@/components/providers/wallet-provider"
import { useVault } from "@/hooks/useVault"
import { toast } from "sonner"

export function VaultActionCard() {
  const { isConnected, connect } = useWalletContext()
  const { depositLiquidity, withdrawLiquidity, isLoading, error } = useVault()
  
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit")
  const [amount, setAmount] = useState("")

  const balance = 12450.0
  const nlpBalance = 8420.5
  const estimatedNlp = amount ? (Number.parseFloat(amount) / 1.042).toFixed(2) : "0.00"
  const estimatedUsdc = amount ? (Number.parseFloat(amount) * 1.042).toFixed(2) : "0.00"

  const handleAction = async () => {
    if (!isConnected) {
      try {
        await connect()
        toast.success("Wallet connected!")
      } catch (err) {
        toast.error("Please connect your wallet")
      }
      return
    }

    const amountValue = parseFloat(amount)
    if (!amountValue || amountValue <= 0) {
      toast.error("Please enter a valid amount")
      return
    }

    try {
      const actionLabel = activeTab === "deposit" ? "Depositing" : "Withdrawing"
      toast.loading(`${actionLabel}...`, { id: "vault-action" })

      let txHash: string | null
      if (activeTab === "deposit") {
        txHash = await depositLiquidity(amountValue)
      } else {
        txHash = await withdrawLiquidity(amountValue)
      }

      if (txHash) {
        toast.success(`${activeTab === "deposit" ? "Deposit" : "Withdrawal"} successful!`, { id: "vault-action" })
        setAmount("")
      } else {
        toast.error(error || `${activeTab === "deposit" ? "Deposit" : "Withdrawal"} failed`, { id: "vault-action" })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Transaction failed", { id: "vault-action" })
    }
  }

  return (
    <div className="relative">
      {/* Vault border glow effect */}
      <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-b from-[#8b5cf6]/30 via-transparent to-[#3b82f6]/30 opacity-50" />

      <div className="relative rounded-2xl border border-white/10 bg-[#0d0d0d] overflow-hidden">
        {/* Header with vault aesthetic */}
        <div className="relative px-6 py-4 border-b border-white/10 bg-gradient-to-r from-[#8b5cf6]/5 to-[#3b82f6]/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-[#8b5cf6]" />
              <span className="font-semibold text-foreground">Vault Operations</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Zap className="h-3 w-3 text-[#22c55e]" />
              <span>Instant settlement</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="p-4">
          <div className="flex gap-2 p-1 rounded-xl bg-secondary/50 border border-white/5">
            <button
              onClick={() => setActiveTab("deposit")}
              className={cn(
                "flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all",
                activeTab === "deposit"
                  ? "bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] text-white shadow-lg shadow-[#8b5cf6]/20"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Deposit USDC
            </button>
            <button
              onClick={() => setActiveTab("withdraw")}
              className={cn(
                "flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all",
                activeTab === "withdraw"
                  ? "bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] text-white shadow-lg shadow-[#8b5cf6]/20"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Withdraw USDC
            </button>
          </div>
        </div>

        {/* Input Section */}
        <div className="px-4 pb-4 space-y-4">
          {/* From Input */}
          <div className="rounded-xl border border-white/10 bg-secondary/30 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">
                {activeTab === "deposit" ? "You Deposit" : "You Withdraw"}
              </span>
              <span className="text-xs text-muted-foreground">
                Balance:{" "}
                <span className="font-mono text-foreground">
                  {activeTab === "deposit" ? `${balance.toLocaleString()} USDC` : `${nlpBalance.toLocaleString()} NLP`}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="flex-1 bg-transparent border-0 text-2xl font-mono text-foreground placeholder:text-muted-foreground/50 p-0 h-auto focus-visible:ring-0 text-right"
              />
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
                <div className="h-6 w-6 rounded-full bg-gradient-to-br from-[#2775ca] to-[#2775ca]/70 flex items-center justify-center text-xs font-bold text-white">
                  {activeTab === "deposit" ? "$" : "N"}
                </div>
                <span className="font-medium text-foreground">{activeTab === "deposit" ? "USDC" : "NLP"}</span>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              {[25, 50, 75, 100].map((pct) => (
                <button
                  key={pct}
                  onClick={() => setAmount(((activeTab === "deposit" ? balance : nlpBalance) * (pct / 100)).toFixed(2))}
                  className="flex-1 py-1.5 text-xs font-medium rounded-md bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors border border-white/5"
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {/* Arrow Divider */}
          <div className="flex justify-center -my-1">
            <div className="p-2 rounded-lg bg-secondary border border-white/10">
              <ArrowDownUp className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>

          {/* To Output */}
          <div className="rounded-xl border border-white/10 bg-secondary/30 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">You Receive</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex-1 text-2xl font-mono text-foreground text-right">
                {activeTab === "deposit" ? estimatedNlp : estimatedUsdc}
              </span>
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
                <div
                  className={cn(
                    "h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold text-white",
                    activeTab === "deposit"
                      ? "bg-gradient-to-br from-[#8b5cf6] to-[#3b82f6]"
                      : "bg-gradient-to-br from-[#2775ca] to-[#2775ca]/70",
                  )}
                >
                  {activeTab === "deposit" ? "N" : "$"}
                </div>
                <span className="font-medium text-foreground">{activeTab === "deposit" ? "NLP" : "USDC"}</span>
              </div>
            </div>
          </div>

          {/* Info Box */}
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1.5">
                Exchange Rate
                <Info className="h-3.5 w-3.5" />
              </span>
              <span className="font-mono text-foreground">1 USDC = 0.9597 NLP</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Fee</span>
              <span className="font-mono text-foreground">0.1%</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Min. Deposit</span>
              <span className="font-mono text-foreground">10 USDC</span>
            </div>
          </div>

          {/* CTA Button */}
          <Button
            onClick={handleAction}
            className="w-full h-14 text-base font-semibold bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] hover:from-[#7c3aed] hover:to-[#2563eb] text-white shadow-lg shadow-[#8b5cf6]/20 transition-all hover:shadow-[#8b5cf6]/30"
            disabled={isLoading || (!amount || Number.parseFloat(amount) <= 0)}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Processing...
              </>
            ) : !isConnected ? (
              "Connect Wallet"
            ) : amount && Number.parseFloat(amount) > 0 ? (
              activeTab === "deposit" ? "Approve & Deposit USDC" : "Withdraw to Wallet"
            ) : (
              "Enter Amount"
            )}
          </Button>

          {/* Security Note */}
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Shield className="h-3.5 w-3.5 text-[#22c55e]" />
            <span>Funds secured by Soroban smart contracts</span>
          </div>
        </div>
      </div>
    </div>
  )
}
