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
        'flex flex-col items-center justify-center p-6 rounded-xl border-2 transition-all',
        'focus:outline-none focus:ring-2 focus:ring-emerald-500/50',
        selected
          ? 'border-emerald-500 bg-emerald-500/10'
          : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]',
        disabled && 'opacity-40 cursor-not-allowed hover:border-white/10 hover:bg-white/[0.02]'
      )}
    >
      <span
        className={cn(
          'text-3xl font-bold mb-1',
          selected ? 'text-emerald-400' : 'text-white'
        )}
      >
        {amount}
      </span>
      <span className="text-sm text-neutral-500">USDC</span>
      <div className="mt-3">
        <div
          className={cn(
            'w-5 h-5 rounded-full border-2 flex items-center justify-center',
            selected
              ? 'border-emerald-500 bg-emerald-500'
              : 'border-neutral-600'
          )}
        >
          {selected && (
            <div className="w-2 h-2 rounded-full bg-white" />
          )}
        </div>
      </div>
    </button>
  );
}
