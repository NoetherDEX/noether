'use client';

import { CheckCircle, AlertCircle, Loader2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { TrustlineStatus } from '@/lib/hooks/useFaucet';

interface TrustlineSectionProps {
  status: TrustlineStatus;
  onAddTrustline: () => void;
  isAdding: boolean;
  error?: string | null;
}

export function TrustlineSection({
  status,
  onAddTrustline,
  isAdding,
  error,
}: TrustlineSectionProps) {
  const issuerAddress = 'GCKIUOTK3NWD33ONH7TQERCSLECXLWQMA377HSJR4E2MV7KPQFAQLOLN';
  const truncatedIssuer = `${issuerAddress.slice(0, 8)}...${issuerAddress.slice(-8)}`;

  return (
    <div className="rounded-2xl border border-white/10 bg-card overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-white/10">
        <h3 className="text-base font-semibold text-foreground">Step 1: USDC Trustline</h3>
      </div>
      <div className="p-6">
        {status === 'checking' && (
          <div className="flex items-center gap-3 p-4 bg-secondary/30 rounded-lg">
            <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
            <span className="text-muted-foreground">Checking trustline status...</span>
          </div>
        )}

        {status === 'active' && (
          <div className="flex items-center gap-3 p-4 bg-[#22c55e]/10 border border-[#22c55e]/20 rounded-lg">
            <CheckCircle className="w-5 h-5 text-[#22c55e]" />
            <div>
              <span className="text-[#22c55e] font-medium">
                USDC Trustline Active
              </span>
              <p className="text-sm text-muted-foreground mt-0.5">
                You&apos;re ready to receive test USDC
              </p>
            </div>
          </div>
        )}

        {(status === 'not_found' || status === 'adding') && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-[#f59e0b]/10 border border-[#f59e0b]/20 rounded-lg">
              <AlertCircle className="w-5 h-5 text-[#f59e0b] flex-shrink-0 mt-0.5" />
              <div>
                <span className="text-[#f59e0b] font-medium">
                  USDC Trustline Not Found
                </span>
                <p className="text-sm text-muted-foreground mt-1">
                  Before receiving USDC, you need to add it to your wallet&apos;s
                  trusted assets. This is a one-time setup.
                </p>
              </div>
            </div>

            <div className="p-4 bg-secondary/30 rounded-lg border border-white/5 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Asset</span>
                <span className="text-foreground font-medium">USDC</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Issuer</span>
                <span className="text-foreground font-mono text-xs">
                  {truncatedIssuer}
                </span>
              </div>
            </div>

            <button
              onClick={onAddTrustline}
              disabled={isAdding}
              className={cn(
                'w-full h-12 text-sm font-bold rounded-lg transition-all',
                'flex items-center justify-center gap-2',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                'bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] text-white hover:opacity-90'
              )}
            >
              {isAdding ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Adding Trustline...
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
            <div className="flex items-start gap-3 p-4 bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-lg">
              <AlertCircle className="w-5 h-5 text-[#ef4444] flex-shrink-0 mt-0.5" />
              <div>
                <span className="text-[#ef4444] font-medium">
                  Error Checking Trustline
                </span>
                {error && (
                  <p className="text-sm text-muted-foreground mt-1">{error}</p>
                )}
              </div>
            </div>

            <button
              onClick={onAddTrustline}
              disabled={isAdding}
              className={cn(
                'w-full h-12 text-sm font-bold rounded-lg transition-all',
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
      </div>
    </div>
  );
}
