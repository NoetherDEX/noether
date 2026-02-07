'use client';

import { ArrowUpRight, ArrowDownRight, Wallet, TrendingUp, Shield } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { DisplayPosition } from '@/types';

interface AccountHealthProps {
  positions: DisplayPosition[];
  usdcBalance: number;
  isConnected: boolean;
  onDeposit?: () => void;
  onWithdraw?: () => void;
}

export function AccountHealth({
  positions,
  usdcBalance,
  isConnected,
}: AccountHealthProps) {
  // Calculate totals from positions
  const totalCollateral = positions.reduce((sum, p) => sum + p.collateral, 0);
  const totalUnrealizedPnl = positions.reduce((sum, p) => sum + p.pnl, 0);
  const netWorth = usdcBalance + totalCollateral + totalUnrealizedPnl;
  const buyingPower = usdcBalance;

  // Calculate margin usage (collateral used / total value)
  const marginUsed = totalCollateral;
  const marginUsagePercent = netWorth > 0 ? (marginUsed / netWorth) * 100 : 0;

  // Calculate monthly change (mock for now - would need historical data)
  const monthlyChangePercent = totalUnrealizedPnl !== 0 ? ((totalUnrealizedPnl / (netWorth - totalUnrealizedPnl)) * 100) : 0;
  const isPositiveMonth = monthlyChangePercent >= 0;
  const isPnlPositive = totalUnrealizedPnl >= 0;

  if (!isConnected) {
    return (
      <div className="grid grid-cols-1 gap-4">
        <div className="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-[#111] to-[#0a0a0a] p-6">
          <div className="absolute top-0 right-0 h-32 w-32 bg-transparent rounded-bl-full" />
          <div className="relative text-center py-8">
            <Wallet className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">Connect Your Wallet</h3>
            <p className="text-sm text-muted-foreground">
              Connect your wallet to view your portfolio and positions
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-8">
      {/* Net Worth Card - Left Column */}
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-[#111] to-[#0a0a0a] p-6">
        <div className="absolute top-0 right-0 h-32 w-32 bg-transparent rounded-bl-full" />
        <div className="relative">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
            <Wallet className="h-4 w-4" />
            <span>Net Worth</span>
          </div>
          <div className="font-mono text-4xl font-bold text-foreground tracking-tight">
            ${netWorth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className={cn(
            'flex items-center gap-1 mt-2 text-sm',
            isPositiveMonth ? 'text-[#22c55e]' : 'text-[#ef4444]'
          )}>
            {isPositiveMonth ? (
              <ArrowUpRight className="h-4 w-4" />
            ) : (
              <ArrowDownRight className="h-4 w-4" />
            )}
            <span className="font-mono">
              {isPositiveMonth ? '+' : ''}{monthlyChangePercent.toFixed(2)}%
            </span>
            <span className="text-muted-foreground ml-1">this month</span>
          </div>
        </div>
      </div>

      {/* Stats Group - Right Column */}
      <div className="grid grid-cols-3 gap-4 h-full">
        {/* Unrealized PnL */}
        <div className="rounded-xl border border-white/10 bg-card p-4 flex flex-col justify-center">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
            <TrendingUp className="h-3.5 w-3.5" />
            <span>Unrealized PnL</span>
          </div>
          <div className={cn(
            'font-mono text-xl font-bold',
            isPnlPositive ? 'text-[#22c55e]' : 'text-[#ef4444]'
          )}>
            {isPnlPositive ? '+' : '-'}${Math.abs(totalUnrealizedPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className={cn(
            'flex items-center gap-1 mt-1 text-xs',
            isPnlPositive ? 'text-[#22c55e]' : 'text-[#ef4444]'
          )}>
            {isPnlPositive ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            <span className="font-mono">
              {totalCollateral > 0 ? `${isPnlPositive ? '+' : ''}${((totalUnrealizedPnl / totalCollateral) * 100).toFixed(1)}%` : '0%'}
            </span>
          </div>
        </div>

        {/* Buying Power */}
        <div className="rounded-xl border border-white/10 bg-card p-4 flex flex-col justify-center">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
            <Shield className="h-3.5 w-3.5" />
            <span>Buying Power</span>
          </div>
          <div className="font-mono text-xl font-bold text-foreground">
            ${buyingPower.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Available to trade</div>
        </div>

        {/* Margin Usage */}
        <div className="rounded-xl border border-white/10 bg-card p-4 flex flex-col justify-center">
          <div className="flex items-center justify-between text-muted-foreground text-xs mb-2">
            <span>Margin Usage</span>
            <span className="font-mono text-foreground">{marginUsagePercent.toFixed(0)}%</span>
          </div>
          {/* Progress bar */}
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                marginUsagePercent > 80 ? 'bg-[#ef4444]' : marginUsagePercent > 50 ? 'bg-[#f59e0b]' : 'bg-gradient-to-r from-[#22c55e] to-[#eab308]'
              )}
              style={{ width: `${Math.min(marginUsagePercent, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>{marginUsagePercent < 30 ? 'Safe' : marginUsagePercent < 60 ? 'Moderate' : 'High'}</span>
            <span>${marginUsed.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
