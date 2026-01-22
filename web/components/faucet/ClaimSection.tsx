'use client';

import { Droplets, Clock } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@/components/ui';
import { AmountCard } from './AmountCard';
import { cn } from '@/lib/utils/cn';
import { CLAIM_AMOUNTS, getAvailableAmounts, getTimeUntilReset } from '@/lib/stellar/faucet';
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
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-lg">Step 2: Claim USDC</CardTitle>
      </CardHeader>
      <CardContent>
        {disabled ? (
          <div className="p-4 bg-white/5 rounded-xl text-center">
            <p className="text-neutral-400">
              Complete Step 1 to claim USDC
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Daily Limit Progress */}
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-neutral-400">Daily Limit</span>
                <span className="text-white font-medium">
                  {claimedToday.toLocaleString()} / {dailyLimit.toLocaleString()} USDC
                </span>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500',
                    progressPercent >= 100
                      ? 'bg-amber-500'
                      : 'bg-gradient-to-r from-emerald-500 to-cyan-500'
                  )}
                  style={{ width: `${Math.min(progressPercent, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-neutral-500">
                  Remaining: {remainingToday.toLocaleString()} USDC
                </span>
                {isLimitReached && (
                  <span className="flex items-center gap-1 text-amber-400">
                    <Clock className="w-3.5 h-3.5" />
                    Resets in {timeUntilReset.hours}h {timeUntilReset.minutes}m
                  </span>
                )}
              </div>
            </div>

            {isLimitReached ? (
              <div className="p-6 bg-amber-500/10 border border-amber-500/20 rounded-xl text-center">
                <Clock className="w-8 h-8 text-amber-400 mx-auto mb-3" />
                <h3 className="text-lg font-medium text-white mb-2">
                  Daily Limit Reached
                </h3>
                <p className="text-neutral-400 text-sm">
                  You&apos;ve claimed 1,000 USDC today. Come back tomorrow for more!
                </p>
                <p className="text-amber-400 font-medium mt-4">
                  Resets in {timeUntilReset.hours}h {timeUntilReset.minutes}m {timeUntilReset.seconds}s
                </p>
              </div>
            ) : (
              <>
                {/* Amount Selection */}
                <div>
                  <p className="text-sm text-neutral-400 mb-3">Select Amount:</p>
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
                <Button
                  variant="success"
                  size="lg"
                  className="w-full"
                  onClick={() => selectedAmount && onClaim(selectedAmount)}
                  disabled={!selectedAmount || isClaiming}
                  isLoading={isClaiming}
                >
                  <Droplets className="w-4 h-4 mr-2" />
                  {isClaiming
                    ? 'Claiming...'
                    : selectedAmount
                    ? `Claim ${selectedAmount} USDC`
                    : 'Select an Amount'}
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
