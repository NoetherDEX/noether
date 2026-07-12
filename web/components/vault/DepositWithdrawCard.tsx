'use client';

import { useState } from 'react';
import { ArrowDownUp, Loader2, Wallet } from 'lucide-react';
import { formatNumber, bpsToPercent } from '@/lib/utils';
import { cn } from '@/lib/utils/cn';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { TrustlineWarning } from './TrustlineWarning';

interface DepositWithdrawCardProps {
  // Deposit state — null preview values mean "unknown" and render as '—'
  depositAmount: string;
  onDepositAmountChange: (value: string) => void;
  onDeposit: () => void;
  isDepositing: boolean;
  usdcBalance: number;
  noeToReceive: number | null;
  depositFee: number | null;
  /** On-chain deposit fee in basis points (30 = 0.30%); null = read failed */
  depositFeeBps: number | null;

  // Withdraw state
  withdrawAmount: string;
  onWithdrawAmountChange: (value: string) => void;
  onWithdraw: () => void;
  isWithdrawing: boolean;
  /** Which of the two withdraw signatures is in flight (1 = approve, 2 = withdraw) */
  withdrawPhase: 1 | 2 | null;
  noeBalance: number;
  usdcToReceive: number | null;
  withdrawFee: number | null;
  /** On-chain withdraw fee in basis points; null = read failed */
  withdrawFeeBps: number | null;

  // Trustline gate — depositing without a NOE trustline is a guaranteed failure
  hasTrustline: boolean;
  onAddTrustline: () => Promise<void>;
  isAddingTrustline?: boolean;

  // Common
  isConnected: boolean;
  onConnectWallet: () => void;
  noePrice: number | null;
  isLoading?: boolean;
}

export function DepositWithdrawCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        <div className="h-5 w-32 bg-surface-2 rounded animate-pulse" />
      </div>
      <div className="p-6 space-y-4">
        <div className="h-10 w-full bg-surface-2 rounded-md animate-pulse" />
        <div className="h-14 w-full bg-surface-2 rounded-md animate-pulse" />
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="flex justify-between">
              <div className="h-4 w-24 bg-surface-2 rounded animate-pulse" />
              <div className="h-4 w-20 bg-surface-2 rounded animate-pulse" />
            </div>
          ))}
        </div>
        <div className="h-12 w-full bg-surface-2 rounded-md animate-pulse" />
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
  depositFeeBps,
  withdrawAmount,
  onWithdrawAmountChange,
  onWithdraw,
  isWithdrawing,
  withdrawPhase,
  noeBalance,
  usdcToReceive,
  withdrawFee,
  withdrawFeeBps,
  hasTrustline,
  onAddTrustline,
  isAddingTrustline,
  isConnected,
  onConnectWallet,
  noePrice,
  isLoading,
}: DepositWithdrawCardProps) {
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');

  if (isLoading) {
    return <DepositWithdrawCardSkeleton />;
  }

  const depositNum = parseFloat(depositAmount) || 0;
  const withdrawNum = parseFloat(withdrawAmount) || 0;

  // Live Connect Wallet CTA (brand gold) — replaces the old dead disabled button
  const connectButton = (
    <button
      onClick={onConnectWallet}
      className={cn(
        'w-full h-12 text-sm font-medium rounded-md transition-colors',
        'flex items-center justify-center gap-2',
        'bg-primary hover:bg-primary/90 text-primary-foreground'
      )}
    >
      <Wallet className="w-4 h-4" />
      Connect Wallet
    </button>
  );

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-border">
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
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
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
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
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
                    Max: <span className="font-mono tabular-nums">{formatNumber(usdcBalance)}</span>
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
                  className="w-full bg-surface-2 border border-border rounded-md px-4 py-3.5 font-mono tabular-nums text-lg text-foreground text-right pr-20 placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <TokenIcon symbol="USDC" size={20} />
                  <span className="text-sm font-medium text-foreground">USDC</span>
                </div>
              </div>
            </div>


            {/* Receive Display */}
            <div>
              <label className="text-sm text-muted-foreground mb-2 block">You Receive</label>
              <div className="relative">
                <div className="w-full bg-surface-2 border border-border rounded-md px-4 py-3.5 font-mono tabular-nums text-lg text-foreground text-right pr-20">
                  {formatNumber(noeToReceive, 4)}
                </div>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <TokenIcon symbol="NOE" size={20} />
                  <span className="text-sm font-medium text-foreground">NOE</span>
                </div>
              </div>
            </div>

            {/* Details */}
            <div className="space-y-2 p-3 bg-surface-2 rounded-md border border-border">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Exchange Rate</span>
                <span className="font-mono tabular-nums text-foreground">
                  {noePrice != null ? `1 NOE = ${formatNumber(noePrice, 3)} USDC` : '—'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Fee{depositFeeBps != null ? ` (${bpsToPercent(depositFeeBps)}%)` : ''}
                </span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {depositFee != null ? `${formatNumber(depositFee)} USDC` : '—'}
                </span>
              </div>
            </div>

            {/* Action Button — connect, then trustline gate, then deposit */}
            {!isConnected ? (
              connectButton
            ) : !hasTrustline ? (
              <TrustlineWarning onAddTrustline={onAddTrustline} isLoading={isAddingTrustline} />
            ) : (
              <button
                onClick={onDeposit}
                disabled={depositNum <= 0 || depositNum > usdcBalance || isDepositing}
                className={cn(
                  'w-full h-12 text-sm font-medium rounded-md transition-colors',
                  'flex items-center justify-center gap-2',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                  'bg-primary hover:bg-primary/90 text-primary-foreground'
                )}
              >
                {isDepositing && <Loader2 className="w-4 h-4 animate-spin" />}
                Deposit USDC
              </button>
            )}

            {/* Plain-language risk line at the point of deposit */}
            <p className="text-xs text-muted-foreground">
              Pool value falls when traders profit — principal at risk.
            </p>
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
                    Max: <span className="font-mono tabular-nums">{formatNumber(noeBalance, 4)}</span>
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
                  className="w-full bg-surface-2 border border-border rounded-md px-4 py-3.5 font-mono tabular-nums text-lg text-foreground text-right pr-20 placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <TokenIcon symbol="NOE" size={20} />
                  <span className="text-sm font-medium text-foreground">NOE</span>
                </div>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex justify-center">
              <div className="p-2 rounded-md bg-surface-2 border border-border">
                <ArrowDownUp className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>

            {/* Receive Display */}
            <div>
              <label className="text-sm text-muted-foreground mb-2 block">You Receive</label>
              <div className="relative">
                <div className="w-full bg-surface-2 border border-border rounded-md px-4 py-3.5 font-mono tabular-nums text-lg text-foreground text-right pr-20">
                  {formatNumber(usdcToReceive)}
                </div>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <TokenIcon symbol="USDC" size={20} />
                  <span className="text-sm font-medium text-foreground">USDC</span>
                </div>
              </div>
            </div>

            {/* Details */}
            <div className="space-y-2 p-3 bg-surface-2 rounded-md border border-border">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Exchange Rate</span>
                <span className="font-mono tabular-nums text-foreground">
                  {noePrice != null ? `1 NOE = ${formatNumber(noePrice, 3)} USDC` : '—'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Fee{withdrawFeeBps != null ? ` (${bpsToPercent(withdrawFeeBps)}%)` : ''}
                </span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {withdrawFee != null ? `${formatNumber(withdrawFee)} USDC` : '—'}
                </span>
              </div>
            </div>

            {/* Action Button */}
            {!isConnected ? (
              connectButton
            ) : (
              <button
                onClick={onWithdraw}
                disabled={withdrawNum <= 0 || withdrawNum > noeBalance || isWithdrawing}
                className={cn(
                  'w-full h-12 text-sm font-medium rounded-md transition-colors',
                  'flex items-center justify-center gap-2',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                  'bg-surface-2 hover:bg-surface-3 text-foreground border border-border'
                )}
              >
                {isWithdrawing && <Loader2 className="w-4 h-4 animate-spin" />}
                {isWithdrawing
                  ? withdrawPhase === 2
                    ? '2/2 Withdrawing…'
                    : '1/2 Approving NOE…'
                  : 'Withdraw USDC'}
              </button>
            )}

            {/* Pre-announce the double signature — no surprise second popup */}
            <p className="text-xs text-muted-foreground">
              Withdrawing takes two wallet signatures — first approve NOE, then withdraw. Up to
              ~40s total.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
