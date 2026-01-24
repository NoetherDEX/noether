'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui';

interface TrustlineWarningProps {
  onAddTrustline: () => Promise<void>;
  isLoading?: boolean;
}

export function TrustlineWarning({ onAddTrustline, isLoading }: TrustlineWarningProps) {
  return (
    <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-400 mb-1">
            Trustline Required
          </p>
          <p className="text-xs text-neutral-400 mb-3">
            Add NOE to your wallet to receive LP tokens when you deposit.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={onAddTrustline}
            isLoading={isLoading}
            className="w-full"
          >
            Add NOE to Wallet
          </Button>
        </div>
      </div>
    </div>
  );
}
