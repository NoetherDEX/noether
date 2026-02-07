'use client';

import { Droplets, Clock, Loader2 } from 'lucide-react';
import { AmountCard } from './AmountCard';
import { cn } from '@/lib/utils/cn';
import { getAvailableAmounts, getTimeUntilReset } from '@/lib/stellar/faucet';
import type { ClaimAmount } from '@/lib/stellar/faucet';
import { useState, useEffect } from 'react';

interface ClaimSectionProps {
  claimedToday: number;
  remainingToday: number;
  dailyLimit: number;
  selectedAmount: ClaimAmount | null;
  onSelectAmount: (amount: ClaimAmount) => void;
  onClaim: (amount: ClaimAmount) => void;
  isClaiming: boolean;
  disabled: boolean;
}

export function ClaimSection({
  claimedToday,
  remainingToday,
  dailyLimit,
  selectedAmount,
  onSelectAmount,
  onClaim,
  isClaiming,
  disabled,
}: ClaimSectionProps) {
  const progressPercent = (claimedToday / dailyLimit) * 100;
  const availableAmounts = getAvailableAmounts(remainingToday);
  const [timeUntilReset, setTimeUntilReset] = useState(getTimeUntilReset());

  // Update countdown every second
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeUntilReset(getTimeUntilReset());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const isLimitReached = remainingToday === 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-card overflow-hidden h-full">
      <div className="px-6 py-4 border-b border-white/10">
        <h3 className="text-base font-semibold text-foreground">Step 2: Claim USDC</h3>
      </div>
      <div className="p-6">
        {disabled ? (
          <div className="p-4 bg-secondary/30 rounded-lg text-center">
            <p className="text-muted-foreground">
              Complete Step 1 to claim USDC
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Daily Limit Progress */}
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Daily Limit</span>
                <span className="text-foreground font-medium font-mono">
                  {claimedToday.toLocaleString()} / {dailyLimit.toLocaleString()} USDC
                </span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500',
                    progressPercent >= 100
                      ? 'bg-[#f59e0b]'
                      : 'bg-[#eab308] text-black'
                  )}
                  style={{ width: `${Math.min(progressPercent, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Remaining: <span className="font-mono">{remainingToday.toLocaleString()}</span> USDC
                </span>
                {isLimitReached && (
                  <span className="flex items-center gap-1 text-[#f59e0b]">
                    <Clock className="w-3.5 h-3.5" />
                    Resets in {timeUntilReset.hours}h {timeUntilReset.minutes}m
                  </span>
                )}
              </div>
            </div>

            {isLimitReached ? (
              <div className="p-6 bg-[#f59e0b]/10 border border-[#f59e0b]/20 rounded-xl text-center">
                <Clock className="w-8 h-8 text-[#f59e0b] mx-auto mb-3" />
                <h3 className="text-lg font-medium text-foreground mb-2">
                  Daily Limit Reached
                </h3>
                <p className="text-muted-foreground text-sm">
                  You&apos;ve claimed 1,000 USDC today. Come back tomorrow for more!
                </p>
                <p className="text-[#f59e0b] font-medium font-mono mt-4">
                  Resets in {timeUntilReset.hours}h {timeUntilReset.minutes}m {timeUntilReset.seconds}s
                </p>
              </div>
            ) : (
              <>
                {/* Amount Selection */}
                <div>
                  <p className="text-sm text-muted-foreground mb-3">Select Amount:</p>
                  <div className="grid grid-cols-3 gap-3">
                    {availableAmounts.map(({ amount, enabled }) => (
                      <AmountCard
                        key={amount}
                        amount={amount}
                        selected={selectedAmount === amount}
                        disabled={!enabled}
                        onClick={() => onSelectAmount(amount)}
                      />
                    ))}
                  </div>
                </div>

                {/* Claim Button */}
                <button
                  onClick={() => selectedAmount && onClaim(selectedAmount)}
                  disabled={!selectedAmount || isClaiming}
                  className={cn(
                    'w-full h-12 text-sm font-bold rounded-lg transition-all',
                    'flex items-center justify-center gap-2',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    'bg-[#22c55e] hover:bg-[#22c55e]/90 text-white'
                  )}
                >
                  {isClaiming ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Claiming...
                    </>
                  ) : (
                    <>
                      <Droplets className="w-4 h-4" />
                      {selectedAmount
                        ? `Claim ${selectedAmount} USDC`
                        : 'Select an Amount'}
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
