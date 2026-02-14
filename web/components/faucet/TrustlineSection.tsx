'use client';

import { CheckCircle, AlertCircle, Loader2, Plus, Rocket } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { TrustlineStatus, AccountStatus } from '@/lib/hooks/useFaucet';

interface TrustlineSectionProps {
  status: TrustlineStatus;
  onAddTrustline: () => void;
  isAdding: boolean;
  error?: string | null;
  accountStatus: AccountStatus;
  onFundAccount: () => void;
  isFundingAccount: boolean;
}

export function TrustlineSection({
  status,
  onAddTrustline,
  isAdding,
  error,
  accountStatus,
  onFundAccount,
  isFundingAccount,
}: TrustlineSectionProps) {
  const issuerAddress = 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN';
  const truncatedIssuer = `${issuerAddress.slice(0, 8)}...${issuerAddress.slice(-8)}`;

  const needsActivation = accountStatus === 'not_found' || accountStatus === 'funding' || accountStatus === 'error';

  return (
    <div className="rounded-2xl border border-white/10 bg-card overflow-hidden h-full flex flex-col">
      <div className="px-6 py-4 border-b border-white/10">
        <h3 className="text-base font-semibold text-foreground">USDC Trustline</h3>
      </div>
      <div className="p-6 flex-1 flex flex-col">
        {/* Account not activated warning */}
        {needsActivation && (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-6 space-y-4">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#f59e0b]/10 border border-[#f59e0b]/20">
              <AlertCircle className="w-6 h-6 text-[#f59e0b]" />
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground">Wallet Not Active</p>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-xs mx-auto leading-relaxed">
                Activate your wallet on the Stellar testnet to get started.
              </p>
            </div>
            <button
              onClick={onFundAccount}
              disabled={isFundingAccount}
              className={cn(
                'w-full h-11 text-sm font-semibold rounded-lg transition-all',
                'flex items-center justify-center gap-2',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                'bg-white text-black hover:bg-white/90'
              )}
            >
              {isFundingAccount ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Activating...
                </>
              ) : (
                <>
                  <Rocket className="w-4 h-4" />
                  Activate Wallet
                </>
              )}
            </button>
          </div>
        )}

        {/* Checking account/trustline */}
        {accountStatus === 'checking' && (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex items-center gap-3">
              <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
              <span className="text-sm text-muted-foreground">Checking account...</span>
            </div>
          </div>
        )}

        {/* Account active - show trustline status */}
        {accountStatus === 'active' && (
          <>
            {status === 'checking' && (
              <div className="flex-1 flex items-center justify-center">
                <div className="flex items-center gap-3">
                  <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                  <span className="text-sm text-muted-foreground">Checking trustline...</span>
                </div>
              </div>
            )}

            {status === 'active' && (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
                <CheckCircle className="w-8 h-8 text-[#22c55e] mb-3" />
                <p className="text-lg font-medium text-foreground">Trustline Active</p>
                <p className="text-sm text-muted-foreground mt-1">Ready to receive test USDC</p>
              </div>
            )}

            {(status === 'not_found' || status === 'adding') && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Add USDC to your wallet&apos;s trusted assets before claiming. One-time setup.
                </p>

                <div className="flex items-center justify-between text-sm p-3 bg-secondary/30 rounded-lg border border-white/5">
                  <span className="text-muted-foreground">Issuer</span>
                  <span className="text-foreground font-mono text-xs">{truncatedIssuer}</span>
                </div>

                <button
                  onClick={onAddTrustline}
                  disabled={isAdding}
                  className={cn(
                    'w-full h-11 text-sm font-medium rounded-lg transition-all',
                    'flex items-center justify-center gap-2',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    'bg-white text-black hover:bg-white/90'
                  )}
                >
                  {isAdding ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Add USDC Trustline
                    </>
                  )}
                </button>
              </div>
            )}

            {status === 'error' && (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-4 h-4 text-[#ef4444] flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-sm font-medium text-[#ef4444]">Error</span>
                    {error && (
                      <p className="text-xs text-muted-foreground mt-1">{error}</p>
                    )}
                  </div>
                </div>

                <button
                  onClick={onAddTrustline}
                  disabled={isAdding}
                  className={cn(
                    'w-full h-11 text-sm font-medium rounded-lg transition-all',
                    'flex items-center justify-center gap-2',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    'bg-secondary hover:bg-secondary/80 text-foreground border border-white/10'
                  )}
                >
                  {isAdding && <Loader2 className="w-4 h-4 animate-spin" />}
                  Retry
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
