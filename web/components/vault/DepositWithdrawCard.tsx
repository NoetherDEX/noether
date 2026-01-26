'use client';

import { useState } from 'react';
import { ArrowDownUp, Loader2 } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { cn } from '@/lib/utils/cn';

interface DepositWithdrawCardProps {
  // Deposit state
  depositAmount: string;
  onDepositAmountChange: (value: string) => void;
  onDeposit: () => void;
  isDepositing: boolean;
  usdcBalance: number;
  noeToReceive: number;
  depositFee: number;

  // Withdraw state
  withdrawAmount: string;
  onWithdrawAmountChange: (value: string) => void;
  onWithdraw: () => void;
  isWithdrawing: boolean;
  noeBalance: number;
  usdcToReceive: number;
  withdrawFee: number;

  // Common
  isConnected: boolean;
  noePrice: number;
  isLoading?: boolean;
}

export function DepositWithdrawCardSkeleton() {
  return (
    <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
      <div className="px-6 py-4 border-b border-white/10">
        <div className="h-5 w-32 bg-white/5 rounded animate-pulse" />
      </div>
      <div className="p-6 space-y-4">
        <div className="h-10 w-full bg-white/5 rounded-lg animate-pulse" />
        <div className="h-14 w-full bg-white/5 rounded-lg animate-pulse" />
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="flex justify-between">
              <div className="h-4 w-24 bg-white/5 rounded animate-pulse" />
              <div className="h-4 w-20 bg-white/5 rounded animate-pulse" />
            </div>
          ))}
        </div>
        <div className="h-12 w-full bg-white/5 rounded-lg animate-pulse" />
      </div>
    </div>
  );
}

export function DepositWithdrawCard({
  depositAmount,
  onDepositAmountChange,
  onDeposit,
  isDepositing,
  usdcBalance,
  noeToReceive,
  depositFee,
  withdrawAmount,
  onWithdrawAmountChange,
  onWithdraw,
  isWithdrawing,
  noeBalance,
  usdcToReceive,
  withdrawFee,
  isConnected,
  noePrice,
  isLoading,
}: DepositWithdrawCardProps) {
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');

  if (isLoading) {
    return <DepositWithdrawCardSkeleton />;
  }

  const depositNum = parseFloat(depositAmount) || 0;
  const withdrawNum = parseFloat(withdrawAmount) || 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-white/10">
        <button
          onClick={() => setActiveTab('deposit')}
          className={cn(
            'flex-1 py-4 text-sm font-medium transition-colors relative',
            activeTab === 'deposit'
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Deposit
          {activeTab === 'deposit' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6]" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('withdraw')}
          className={cn(
            'flex-1 py-4 text-sm font-medium transition-colors relative',
            activeTab === 'withdraw'
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Withdraw
          {activeTab === 'withdraw' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6]" />
          )}
        </button>
      </div>

      <div className="p-6">
        {activeTab === 'deposit' ? (
          <div className="space-y-5">
            {/* Amount Input */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-muted-foreground">You Pay</label>
                {isConnected && (
                  <button
                    onClick={() => onDepositAmountChange(Math.floor(usdcBalance * 0.95).toString())}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Max: <span className="font-mono">{formatNumber(usdcBalance)}</span>
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={depositAmount}
                  onChange={(e) => onDepositAmountChange(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  className="w-full bg-zinc-900/50 border border-white/10 rounded-lg px-4 py-3.5 font-mono text-lg text-foreground text-right pr-20 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-[#2775ca] flex items-center justify-center">
                    <span className="text-[10px] font-bold text-white">$</span>
                  </div>
                  <span className="text-sm font-medium text-foreground">USDC</span>
                </div>
              </div>
            </div>


            {/* Receive Display */}
            <div>
              <label className="text-sm text-muted-foreground mb-2 block">You Receive</label>
              <div className="relative">
                <div className="w-full bg-zinc-900/50 border border-white/5 rounded-lg px-4 py-3.5 font-mono text-lg text-foreground text-right pr-20">
                  {formatNumber(noeToReceive, 4)}
                </div>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#8b5cf6] to-[#3b82f6] flex items-center justify-center">
                    <span className="text-[10px] font-bold text-white">N</span>
                  </div>
                  <span className="text-sm font-medium text-foreground">NOE</span>
                </div>
              </div>
            </div>

            {/* Details */}
            <div className="space-y-2 p-3 bg-secondary/20 rounded-lg border border-white/5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Exchange Rate</span>
                <span className="font-mono text-foreground">1 NOE = {formatNumber(noePrice, 3)} USDC</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Fee (0.3%)</span>
                <span className="font-mono text-muted-foreground">{formatNumber(depositFee)} USDC</span>
              </div>
            </div>

            {/* Action Button */}
            <button
              onClick={onDeposit}
              disabled={!isConnected || depositNum <= 0 || depositNum > usdcBalance || isDepositing}
              className={cn(
                'w-full h-12 text-sm font-bold rounded-lg transition-all',
                'flex items-center justify-center gap-2',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                'bg-[#22c55e] hover:bg-[#22c55e]/90 text-white shadow-lg shadow-[#22c55e]/30'
              )}
            >
              {isDepositing && <Loader2 className="w-4 h-4 animate-spin" />}
              {!isConnected ? 'Connect Wallet' : 'Deposit USDC'}
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Amount Input */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-muted-foreground">You Pay</label>
                {isConnected && noeBalance > 0 && (
                  <button
                    onClick={() => onWithdrawAmountChange(noeBalance.toString())}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Max: <span className="font-mono">{formatNumber(noeBalance, 4)}</span>
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={withdrawAmount}
                  onChange={(e) => onWithdrawAmountChange(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  className="w-full bg-zinc-900/50 border border-white/10 rounded-lg px-4 py-3.5 font-mono text-lg text-foreground text-right pr-20 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#8b5cf6] to-[#3b82f6] flex items-center justify-center">
                    <span className="text-[10px] font-bold text-white">N</span>
                  </div>
                  <span className="text-sm font-medium text-foreground">NOE</span>
                </div>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex justify-center">
              <div className="p-2 rounded-lg bg-secondary/50 border border-white/10">
                <ArrowDownUp className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>

            {/* Receive Display */}
            <div>
              <label className="text-sm text-muted-foreground mb-2 block">You Receive</label>
              <div className="relative">
                <div className="w-full bg-zinc-900/50 border border-white/5 rounded-lg px-4 py-3.5 font-mono text-lg text-foreground text-right pr-20">
                  {formatNumber(usdcToReceive)}
                </div>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-[#2775ca] flex items-center justify-center">
                    <span className="text-[10px] font-bold text-white">$</span>
                  </div>
                  <span className="text-sm font-medium text-foreground">USDC</span>
                </div>
              </div>
            </div>

            {/* Details */}
            <div className="space-y-2 p-3 bg-secondary/20 rounded-lg border border-white/5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Exchange Rate</span>
                <span className="font-mono text-foreground">1 NOE = {formatNumber(noePrice, 3)} USDC</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Fee (0.3%)</span>
                <span className="font-mono text-muted-foreground">{formatNumber(withdrawFee)} USDC</span>
              </div>
            </div>

            {/* Action Button */}
            <button
              onClick={onWithdraw}
              disabled={!isConnected || withdrawNum <= 0 || withdrawNum > noeBalance || isWithdrawing}
              className={cn(
                'w-full h-12 text-sm font-bold rounded-lg transition-all',
                'flex items-center justify-center gap-2',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                'bg-secondary hover:bg-secondary/80 text-foreground border border-white/10'
              )}
            >
              {isWithdrawing && <Loader2 className="w-4 h-4 animate-spin" />}
              {!isConnected ? 'Connect Wallet' : 'Withdraw USDC'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
