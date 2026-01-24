'use client';

import { Card, CardContent, Tabs, Input, Button, Skeleton } from '@/components/ui';
import { formatNumber } from '@/lib/utils';

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
    <Card className="h-full">
      <CardContent className="pt-6">
        <div className="flex gap-1 p-1 bg-white/5 rounded-xl mb-4">
          <Skeleton className="flex-1 h-10 rounded-lg" />
          <Skeleton className="flex-1 h-10 rounded-lg" />
        </div>
        <div className="space-y-4">
          <div>
            <Skeleton className="h-4 w-16 mb-2" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
          <div className="p-4 bg-white/5 rounded-xl space-y-2">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="flex justify-between">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </CardContent>
    </Card>
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
  if (isLoading) {
    return <DepositWithdrawCardSkeleton />;
  }

  const depositNum = parseFloat(depositAmount) || 0;
  const withdrawNum = parseFloat(withdrawAmount) || 0;

  const tabs = [
    {
      id: 'deposit',
      label: 'Deposit',
      content: (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-neutral-400">Amount</span>
              {isConnected && (
                <button
                  onClick={() => onDepositAmountChange(Math.floor(usdcBalance * 0.95).toString())}
                  className="text-xs text-neutral-500 hover:text-white transition-colors"
                >
                  Max: {formatNumber(usdcBalance)} USDC
                </button>
              )}
            </div>
            <Input
              type="number"
              value={depositAmount}
              onChange={(e) => onDepositAmountChange(e.target.value)}
              placeholder="0.00"
              suffix="USDC"
              className="text-right text-xl"
            />
          </div>

          <div className="h-px bg-white/10" />

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-400">You will receive</span>
              <span className="text-white font-medium">
                {formatNumber(noeToReceive, 4)} NOE
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-neutral-400">Fee (0.3%)</span>
              <span className="text-neutral-300">
                {formatNumber(depositFee)} USDC
              </span>
            </div>
          </div>

          <div className="h-px bg-white/10" />

          <Button
            variant="success"
            size="lg"
            className="w-full"
            onClick={onDeposit}
            disabled={!isConnected || depositNum <= 0 || depositNum > usdcBalance}
            isLoading={isDepositing}
          >
            {!isConnected ? 'Connect Wallet' : 'Deposit USDC'}
          </Button>
        </div>
      ),
    },
    {
      id: 'withdraw',
      label: 'Withdraw',
      content: (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-neutral-400">Amount</span>
              {isConnected && noeBalance > 0 && (
                <button
                  onClick={() => onWithdrawAmountChange(noeBalance.toString())}
                  className="text-xs text-neutral-500 hover:text-white transition-colors"
                >
                  Max: {formatNumber(noeBalance, 4)} NOE
                </button>
              )}
            </div>
            <Input
              type="number"
              value={withdrawAmount}
              onChange={(e) => onWithdrawAmountChange(e.target.value)}
              placeholder="0.00"
              suffix="NOE"
              className="text-right text-xl"
            />
          </div>

          <div className="h-px bg-white/10" />

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-400">You will receive</span>
              <span className="text-white font-medium">
                {formatNumber(usdcToReceive)} USDC
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-neutral-400">Fee (0.3%)</span>
              <span className="text-neutral-300">
                {formatNumber(withdrawFee)} USDC
              </span>
            </div>
          </div>

          <div className="h-px bg-white/10" />

          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={onWithdraw}
            disabled={!isConnected || withdrawNum <= 0 || withdrawNum > noeBalance}
            isLoading={isWithdrawing}
          >
            {!isConnected ? 'Connect Wallet' : 'Withdraw USDC'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card className="h-full">
      <CardContent className="pt-6">
        <Tabs tabs={tabs} defaultTab="deposit" />
      </CardContent>
    </Card>
  );
}
