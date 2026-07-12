'use client';

import { cn } from '@/lib/utils/cn';
import type { ClaimAmount } from '@/lib/stellar/faucet';

interface AmountCardProps {
  amount: ClaimAmount;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}

export function AmountCard({
  amount,
  selected,
  disabled,
  onClick,
}: AmountCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'relative p-4 rounded-md border transition-colors text-center',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        selected
          ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/50'
          : 'border-border bg-surface-2 hover:border-border-strong hover:bg-surface-3'
      )}
    >
      <span className="text-xl font-medium font-mono tabular-nums text-foreground">
        {amount}
      </span>
      <span className="block text-xs text-muted-foreground mt-1">USDC</span>
      {selected && (
        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
      )}
    </button>
  );
}
