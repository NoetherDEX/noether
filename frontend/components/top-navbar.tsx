"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronDown, Wallet, LayoutGrid, Layout, LogOut, Loader2, RefreshCw, Copy, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { useWalletContext, formatAddress } from "@/components/providers/wallet-provider"
import { useBalances } from "@/hooks/useBalances"
import { toast } from "sonner"

interface TopNavbarProps {
  viewMode?: "pro" | "basic"
  onViewModeChange?: (mode: "pro" | "basic") => void
}

// Network display config
const NETWORK_CONFIG = {
  testnet: { label: "Stellar Testnet", color: "#22c55e" },
  futurenet: { label: "Stellar Futurenet", color: "#f59e0b" },
  mainnet: { label: "Stellar Mainnet", color: "#3b82f6" },
  unknown: { label: "Unknown Network", color: "#ef4444" },
} as const

export function TopNavbar({ viewMode = "pro", onViewModeChange }: TopNavbarProps) {
  const pathname = usePathname()
  const { isConnected, isLoading, address, network, connect, disconnect } = useWalletContext()
  const { xlm, usdc, refresh: refreshBalances, isLoading: balancesLoading } = useBalances()

  const networkConfig = NETWORK_CONFIG[network] || NETWORK_CONFIG.unknown

  const handleConnect = async () => {
    try {
      await connect()
      toast.success("Wallet connected successfully!")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect wallet")
    }
  }

  const handleDisconnect = () => {
    disconnect()
    toast.info("Wallet disconnected")
  }

  const handleCopyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address)
      toast.success("Address copied to clipboard")
    }
  }

  const handleRefreshBalances = async () => {
    toast.loading("Refreshing balances...", { id: "refresh" })
    await refreshBalances()
    toast.success("Balances updated", { id: "refresh" })
  }

  const navItems = [
    { label: "Trade", href: "/trade" },
    { label: "Portfolio", href: "/portfolio" },
    { label: "Earn/Vault", href: "/earn" },
    { label: "Leaderboard", href: "/leaderboard" },
  ]

  return (
    <header className="sticky top-0 z-50 h-14 border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-xl">
      <div className="flex h-full items-center justify-between px-4">
        {/* Left Section - Logo & Market Selector */}
        <div className="flex items-center gap-6">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="relative h-8 w-8">
              <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-[#8b5cf6] to-[#3b82f6]" />
              <div className="absolute inset-[2px] rounded-md bg-[#0a0a0a] flex items-center justify-center">
                <span className="text-sm font-bold bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] bg-clip-text text-transparent">
                  N
                </span>
              </div>
            </div>
            <span className="text-lg font-semibold text-foreground">Noether</span>
          </Link>

          {/* Market Selector - Only show on trade page */}
          {pathname === "/trade" && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-9 gap-2 bg-secondary/50 hover:bg-secondary border border-white/10 px-3"
                  >
                    <span className="font-semibold text-foreground">BTC-PERP</span>
                    <span className="font-mono text-[#22c55e] text-sm">$98,420</span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48 bg-card border-white/10">
                  <DropdownMenuItem className="font-mono">
                    <span className="flex-1">BTC-PERP</span>
                    <span className="text-[#22c55e]">$98,420</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="font-mono">
                    <span className="flex-1">ETH-PERP</span>
                    <span className="text-[#22c55e]">$3,847</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="font-mono">
                    <span className="flex-1">XLM-PERP</span>
                    <span className="text-[#ef4444]">$0.4521</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="font-mono">
                    <span className="flex-1">SOL-PERP</span>
                    <span className="text-[#22c55e]">$234.56</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="flex items-center h-9 bg-secondary/50 border border-white/10 rounded-lg p-1">
                <button
                  onClick={() => onViewModeChange?.("basic")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200",
                    viewMode === "basic"
                      ? "bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] text-white shadow-lg"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Layout className="h-3.5 w-3.5" />
                  Basic
                </button>
                <button
                  onClick={() => onViewModeChange?.("pro")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200",
                    viewMode === "pro"
                      ? "bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] text-white shadow-lg"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Pro
                </button>
              </div>
            </>
          )}
        </div>

        {/* Center Section - Navigation Links */}
        <nav className="flex items-center gap-1">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <Button
                variant="ghost"
                className={cn(
                  "px-4",
                  pathname === item.href
                    ? "text-foreground bg-white/5"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5",
                )}
              >
                {item.label}
              </Button>
            </Link>
          ))}
        </nav>

        {/* Right Section - Wallet & Network */}
        <div className="flex items-center gap-4">
          {/* Network Status */}
          <div className="flex items-center gap-2 text-sm">
            <div className="relative">
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: networkConfig.color }}
              />
              <div
                className="absolute inset-0 h-2 w-2 rounded-full animate-ping opacity-75"
                style={{ backgroundColor: networkConfig.color }}
              />
            </div>
            <span className="text-muted-foreground">{networkConfig.label}</span>
          </div>

          {/* Connect Wallet Button */}
          {isConnected && address ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div className="relative p-[1px] rounded-lg bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6]">
                  <Button className="bg-[#0a0a0a] hover:bg-[#111] text-foreground rounded-[7px] px-4 gap-2">
                    <div className="h-2 w-2 rounded-full bg-[#22c55e]" />
                    <span className="font-mono text-sm">{formatAddress(address, 4)}</span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 bg-card border-white/10">
                {/* Address with copy */}
                <DropdownMenuItem
                  onClick={handleCopyAddress}
                  className="font-mono text-xs text-muted-foreground cursor-pointer"
                >
                  <span className="flex-1">{formatAddress(address, 8)}</span>
                  <Copy className="h-3 w-3" />
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* Balances */}
                <div className="px-2 py-2 space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">XLM Balance</span>
                    <span className="font-mono text-foreground">
                      {balancesLoading ? "..." : xlm.balance}
                    </span>
                  </div>
                  {usdc && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">USDC Balance</span>
                      <span className="font-mono text-foreground">{usdc.balance}</span>
                    </div>
                  )}
                </div>

                <DropdownMenuSeparator />

                {/* Actions */}
                <DropdownMenuItem
                  onClick={handleRefreshBalances}
                  className="cursor-pointer"
                  disabled={balancesLoading}
                >
                  <RefreshCw className={cn("h-4 w-4 mr-2", balancesLoading && "animate-spin")} />
                  Refresh Balances
                </DropdownMenuItem>

                <DropdownMenuItem asChild>
                  <a
                    href={`https://stellar.expert/explorer/testnet/account/${address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cursor-pointer"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    View on Explorer
                  </a>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem onClick={handleDisconnect} className="text-[#ef4444] cursor-pointer">
                  <LogOut className="h-4 w-4 mr-2" />
                  Disconnect
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="relative p-[1px] rounded-lg bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6]">
              <Button
                onClick={handleConnect}
                disabled={isLoading}
                className="bg-[#0a0a0a] hover:bg-[#111] text-foreground rounded-[7px] px-4 gap-2"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wallet className="h-4 w-4" />
                )}
                {isLoading ? "Connecting..." : "Connect Wallet"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
