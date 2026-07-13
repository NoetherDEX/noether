'use client';

import { Button } from '@/components/ui';

interface TrustlineWarningProps {
  onAddTrustline: () => Promise<void>;
  isLoading?: boolean;
}

export function TrustlineWarning({ onAddTrustline, isLoading }: TrustlineWarningProps) {
  return (
    <div className="border-l-2 border-primary/60 pl-3 py-1">
      <p className="text-xs font-medium text-primary mb-1">Trustline Required</p>
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
