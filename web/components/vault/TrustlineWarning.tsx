'use client';

import { Button } from '@/components/ui';

interface TrustlineWarningProps {
  onAddTrustline: () => Promise<void>;
  isLoading?: boolean;
}

export function TrustlineWarning({ onAddTrustline, isLoading }: TrustlineWarningProps) {
  return (
    <div className="p-4 rounded-lg border border-white/[0.06] bg-white/[0.02]">
      <p className="text-sm font-medium text-[#f59e0b] mb-1">Trustline Required</p>
      <p className="text-xs text-muted-foreground mb-3">
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
  );
}
