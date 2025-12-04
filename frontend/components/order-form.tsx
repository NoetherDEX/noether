"use client"

import { useState, useMemo } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { ChevronDown, Info, AlertTriangle, Loader2, Wallet, ExternalLink } from "lucide-react"
import { useWalletContext } from "@/components/providers/wallet-provider"
import { useBalances } from "@/hooks/useBalances"
import { useMarket } from "@/hooks/useMarket"
import { toast } from "sonner"

type OrderSide = "long" | "short"
type OrderType = "market" | "limit" | "stop"

export function OrderForm() {
  const { isConnected, connect, network } = useWalletContext()
  const { usdc, xlm, isLoading: balancesLoading, error: balanceError, fundWithFriendbot } = useBalances()
  const { openPosition, isLoading: isSubmitting, error: marketError } = useMarket()

  const [side, setSide] = useState<OrderSide>("long")
  const [orderType, setOrderType] = useState<OrderType>("market")
  const [leverage, setLeverage] = useState([5])
  const [collateral, setCollateral] = useState("")
  const [size, setSize] = useState("")
  const [limitPrice, setLimitPrice] = useState("")
  const [isFunding, setIsFunding] = useState(false)

  const currentPrice = 98420

  // Use real USDC balance, fall back to XLM if no USDC
  const userBalance = usdc?.balanceNum ?? 0
  const hasBalance = userBalance > 0
  const needsFunding = xlm.balanceNum === 0 && !balancesLoading

  // Handle Friendbot funding
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
    } catch (err) {
      toast.error("Friendbot funding failed", { id: "friendbot" })
    } finally {
      setIsFunding(false)
    }
  }

  // Handle order submission
  const handleSubmitOrder = async () => {
    if (!isConnected) {
      try {
        await connect()
        toast.success("Wallet connected! You can now place orders.")
      } catch (err) {
        toast.error("Please connect your wallet to trade")
      }
      return
    }

    const collateralValue = parseFloat(collateral)
    const sizeValue = parseFloat(size) || (collateralValue * leverage[0]) / currentPrice

    if (!collateralValue || collateralValue <= 0) {
      toast.error("Please enter a valid collateral amount")
      return
    }

    if (collateralValue > userBalance) {
      toast.error(`Insufficient balance. You have ${userBalance.toFixed(2)} USDC`)
      return
    }

    try {
      toast.loading("Submitting order...", { id: "order" })

      const txHash = await openPosition(
        collateralValue,
        sizeValue * currentPrice, // Convert BTC size to USD position value
        side === "long"
      )

      if (txHash) {
        toast.success(`Order placed successfully!`, { id: "order" })
        // Reset form
        setCollateral("")
        setSize("")
      } else {
        toast.error(marketError || "Failed to place order", { id: "order" })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Order failed", { id: "order" })
    }
  }

  // Calculate dynamic values based on inputs
  const calculations = useMemo(() => {
    const collateralValue = Number.parseFloat(collateral) || 0
    const sizeValue = Number.parseFloat(size) || 0
    const lev = leverage[0]

    const positionSize = collateralValue * lev
    const entryPrice = orderType === "market" ? currentPrice : Number.parseFloat(limitPrice) || currentPrice

    // Liquidation price calculation (simplified)
    const liquidationDistance = (entryPrice / lev) * 0.9
    const liquidationPrice = side === "long" ? entryPrice - liquidationDistance : entryPrice + liquidationDistance

    // Risk assessment
    const liquidationRisk = lev >= 15 ? "high" : lev >= 10 ? "medium" : "low"

    // Price impact (mock calculation based on size)
    const priceImpact = positionSize > 50000 ? 0.12 : positionSize > 10000 ? 0.05 : 0.02

    // Trading fee (0.05% taker, 0.02% maker)
    const feeRate = orderType === "market" ? 0.0005 : 0.0002
    const tradingFee = positionSize * feeRate

    return {
      positionSize,
      entryPrice,
      liquidationPrice,
      liquidationRisk,
      priceImpact,
      tradingFee,
      sizeInBtc: positionSize / entryPrice,
    }
  }, [collateral, size, leverage, side, orderType, limitPrice])

  // Percentage buttons for collateral
  const handlePercentage = (pct: number) => {
    if (userBalance > 0) {
      setCollateral(((userBalance * pct) / 100).toFixed(2))
    }
  }

  // Handle Max button
  const handleMax = () => {
    if (userBalance > 0) {
      setCollateral(userBalance.toFixed(2))
    }
  }

  return (
    <div className="h-full rounded-lg border border-white/10 bg-card overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10">
        <h3 className="text-sm font-medium text-foreground">Place Order</h3>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Wallet Not Connected State */}
        {!isConnected && (
          <div className="p-4 rounded-lg bg-secondary/30 border border-white/10 text-center space-y-3">
            <Wallet className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Connect your wallet to start trading
            </p>
            <Button
              onClick={() => connect()}
              className="bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] text-white"
            >
              Connect Wallet
            </Button>
          </div>
        )}

        {/* Account Needs Funding State */}
        {isConnected && needsFunding && (
          <div className="p-4 rounded-lg bg-[#f59e0b]/10 border border-[#f59e0b]/30 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-[#f59e0b] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">Account Not Funded</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Your account needs XLM to activate and pay for transactions.
                </p>
              </div>
            </div>
            {(network === "testnet" || network === "futurenet") && (
              <Button
                onClick={handleFundWithFriendbot}
                disabled={isFunding}
                className="w-full bg-[#f59e0b] hover:bg-[#f59e0b]/90 text-black font-semibold"
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
            )}
            {network === "mainnet" && (
              <a
                href="https://www.stellar.org/lumens"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 text-sm text-[#3b82f6] hover:underline"
              >
                Get XLM <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}

        {/* Long/Short Tabs */}
        <div className="grid grid-cols-2 gap-0 rounded-lg overflow-hidden border border-white/10">
          <button
            onClick={() => setSide("long")}
            className={cn(
              "py-3 text-sm font-bold transition-all relative",
              side === "long"
                ? "bg-[#22c55e] text-white"
                : "bg-secondary/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50",
            )}
          >
            Long
            {side === "long" && <div className="absolute inset-0 bg-[#22c55e]/20 animate-pulse" />}
          </button>
          <button
            onClick={() => setSide("short")}
            className={cn(
              "py-3 text-sm font-bold transition-all relative",
              side === "short"
                ? "bg-[#ef4444] text-white"
                : "bg-secondary/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50",
            )}
          >
            Short
            {side === "short" && <div className="absolute inset-0 bg-[#ef4444]/20 animate-pulse" />}
          </button>
        </div>

        {/* Order Type Selector */}
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Order Type</label>
          <div className="relative">
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value as OrderType)}
              className="w-full appearance-none bg-secondary/50 border border-white/10 rounded-md px-3 py-2.5 text-sm text-foreground font-medium cursor-pointer hover:border-white/20 transition-colors focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="market">Market</option>
              <option value="limit">Limit</option>
              <option value="stop">Stop Market</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* Limit/Stop Price Input */}
        {orderType !== "market" && (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground flex items-center gap-1.5">
              {orderType === "limit" ? "Limit Price" : "Trigger Price"}
              <Info className="h-3 w-3 opacity-50" />
            </label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder={currentPrice.toLocaleString()}
                className="w-full bg-secondary/50 border border-white/10 rounded-md px-3 py-3 text-right font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">
                USD
              </span>
            </div>
          </div>
        )}

        {/* Pay (Collateral) Input */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground flex items-center gap-1.5">
              Pay (Collateral)
              <Info className="h-3 w-3 opacity-50" />
            </label>
          </div>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={collateral}
              onChange={(e) => setCollateral(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.00"
              className="w-full bg-secondary/50 border border-white/10 rounded-md px-3 py-3 text-right font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors pr-16 pl-2"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              <div className="w-4 h-4 rounded-full bg-[#2775ca] flex items-center justify-center">
                <span className="text-[8px] font-bold text-white">$</span>
              </div>
              <span className="text-xs font-medium text-foreground">USDC</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Balance:{" "}
              <span className={cn(
                "font-mono",
                balancesLoading ? "text-muted-foreground" : hasBalance ? "text-foreground" : "text-[#f59e0b]"
              )}>
                {balancesLoading ? "..." : userBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>{" "}
              USDC
            </span>
            <button
              onClick={handleMax}
              disabled={!hasBalance}
              className={cn(
                "text-xs font-medium transition-colors",
                hasBalance
                  ? "text-primary hover:text-primary/80"
                  : "text-muted-foreground/50 cursor-not-allowed"
              )}
            >
              Max
            </button>
          </div>
          {/* Percentage Buttons */}
          <div className="grid grid-cols-4 gap-1.5">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                onClick={() => handlePercentage(pct)}
                disabled={!hasBalance}
                className={cn(
                  "py-1.5 text-xs font-medium rounded border transition-all",
                  hasBalance
                    ? "text-muted-foreground hover:text-foreground bg-secondary/30 hover:bg-secondary/60 border-white/5 hover:border-white/10"
                    : "text-muted-foreground/30 bg-secondary/10 border-white/5 cursor-not-allowed"
                )}
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>

        {/* Size (Position) Input */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground flex items-center gap-1.5">
              Size (Position)
              <Info className="h-3 w-3 opacity-50" />
            </label>
          </div>
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={size}
              onChange={(e) => setSize(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.0000"
              className="w-full bg-secondary/50 border border-white/10 rounded-md px-3 py-3 text-right font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors pr-14"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              <div className="w-4 h-4 rounded-full bg-[#f7931a] flex items-center justify-center">
                <span className="text-[8px] font-bold text-white">₿</span>
              </div>
              <span className="text-xs font-medium text-foreground">BTC</span>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Leverage: <span className="font-mono text-foreground">{leverage[0].toFixed(1)}x</span>
            {calculations.positionSize > 0 && (
              <>
                {" "}
                · Position:{" "}
                <span className="font-mono text-foreground">
                  ${calculations.positionSize.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Leverage Slider */}
        <div className="space-y-3 p-3 bg-secondary/20 rounded-lg border border-white/5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground flex items-center gap-1.5">
              Leverage
              <Info className="h-3 w-3 opacity-50" />
            </label>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-lg font-mono font-bold",
                  leverage[0] >= 15 ? "text-[#ef4444]" : leverage[0] >= 10 ? "text-[#f59e0b]" : "text-foreground",
                )}
              >
                {leverage[0].toFixed(1)}x
              </span>
            </div>
          </div>

          <div className="relative pt-1">
            <Slider
              value={leverage}
              onValueChange={setLeverage}
              min={1.1}
              max={20}
              step={0.1}
              className={cn(
                "[&_[role=slider]]:h-4 [&_[role=slider]]:w-4 [&_[role=slider]]:border-2",
                "[&_[role=slider]]:bg-background [&_[role=slider]]:border-white/50",
                "[&_[role=slider]]:shadow-lg [&_[role=slider]]:shadow-black/50",
                "[&_.relative]:h-1.5",
              )}
            />
            {/* Leverage scale markers */}
            <div className="flex justify-between mt-2 px-0.5">
              {[1.1, 5, 10, 15, 20].map((mark) => (
                <span
                  key={mark}
                  className={cn(
                    "text-[10px] font-mono",
                    leverage[0] >= mark ? "text-foreground" : "text-muted-foreground/50",
                  )}
                >
                  {mark === 1.1 ? "1.1x" : `${mark}x`}
                </span>
              ))}
            </div>
          </div>

          {/* Quick leverage buttons */}
          <div className="grid grid-cols-5 gap-1.5">
            {[1.1, 2, 5, 10, 20].map((lev) => (
              <button
                key={lev}
                onClick={() => setLeverage([lev])}
                className={cn(
                  "py-1.5 text-xs font-mono font-medium rounded border transition-all",
                  Math.abs(leverage[0] - lev) < 0.05
                    ? "bg-primary/20 border-primary/50 text-primary"
                    : "border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20",
                )}
              >
                {lev}x
              </button>
            ))}
          </div>
        </div>

        {/* Order Summary Box */}
        <div className="space-y-2.5 p-3 bg-secondary/20 rounded-lg border border-white/5">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Order Summary</h4>

          <div className="space-y-2">
            {/* Entry Price */}
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground flex items-center gap-1">Entry Price</span>
              <span className="font-mono text-sm text-foreground">${calculations.entryPrice.toLocaleString()}</span>
            </div>

            {/* Liquidation Price */}
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                Liq. Price
                {calculations.liquidationRisk === "high" && <AlertTriangle className="h-3 w-3 text-[#ef4444]" />}
              </span>
              <span
                className={cn(
                  "font-mono text-sm font-medium",
                  calculations.liquidationRisk === "high"
                    ? "text-[#ef4444]"
                    : calculations.liquidationRisk === "medium"
                      ? "text-[#f59e0b]"
                      : "text-foreground",
                )}
              >
                ${calculations.liquidationPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>

            {/* Divider */}
            <div className="border-t border-white/5 my-1" />

            {/* Price Impact */}
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">Price Impact</span>
              <span
                className={cn(
                  "font-mono text-xs",
                  calculations.priceImpact > 0.1 ? "text-[#f59e0b]" : "text-muted-foreground",
                )}
              >
                ~{calculations.priceImpact.toFixed(2)}%
              </span>
            </div>

            {/* Trading Fee */}
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">Fee ({orderType === "market" ? "0.05%" : "0.02%"})</span>
              <span className="font-mono text-xs text-muted-foreground">${calculations.tradingFee.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* CTA Button */}
        <Button
          onClick={handleSubmitOrder}
          disabled={isSubmitting || (isConnected && (!collateral || Number.parseFloat(collateral) <= 0))}
          className={cn(
            "w-full h-14 text-base font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed",
            !isConnected
              ? "bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] text-white shadow-lg shadow-[#8b5cf6]/30"
              : side === "long"
                ? "bg-[#22c55e] hover:bg-[#22c55e]/90 text-white shadow-lg shadow-[#22c55e]/30"
                : "bg-[#ef4444] hover:bg-[#ef4444]/90 text-white shadow-lg shadow-[#ef4444]/30",
          )}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Processing...
            </>
          ) : !isConnected ? (
            "Connect Wallet to Trade"
          ) : (
            <>{side === "long" ? "Buy / Long" : "Sell / Short"} BTC</>
          )}
        </Button>

        {/* Balance Error */}
        {balanceError && (
          <p className="text-xs text-[#f59e0b] text-center">{balanceError}</p>
        )}

        {/* TP/SL Link */}
        <button className="w-full text-xs text-muted-foreground hover:text-primary transition-colors py-1">
          + Add Take Profit / Stop Loss
        </button>
      </div>
    </div>
  )
}
