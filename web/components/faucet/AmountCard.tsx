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
        'relative p-4 rounded-xl border transition-all text-center',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        selected
          ? 'border-[#8b5cf6]/50 bg-gradient-to-br from-[#8b5cf6]/20 to-[#3b82f6]/10 ring-1 ring-[#8b5cf6]/50'
          : 'border-white/10 bg-secondary/30 hover:border-white/20 hover:bg-secondary/50'
      )}
    >
      <span className="text-xl font-bold font-mono text-foreground">
        {amount}
      </span>
      <span className="block text-xs text-muted-foreground mt-1">USDC</span>
      {selected && (
        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#8b5cf6]" />
      )}
    </button>
  );
}
