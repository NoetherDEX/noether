'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export function HowItWorks() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
      >
        <h3 className="text-sm font-medium text-foreground">How It Works</h3>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      <div
        className={cn(
          'overflow-hidden transition-all duration-300',
          isExpanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="px-6 pb-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4">
              <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Step 1</span>
              <p className="text-sm font-medium text-foreground mt-1.5">Deposit</p>
              <p className="text-xs text-muted-foreground mt-1">USDC in, NOE tokens out.</p>
            </div>
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4">
              <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Step 2</span>
              <p className="text-sm font-medium text-foreground mt-1.5">Earn</p>
              <p className="text-xs text-muted-foreground mt-1">0.1% fee on every trade + trader losses.</p>
            </div>
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4">
              <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Step 3</span>
              <p className="text-sm font-medium text-foreground mt-1.5">Withdraw</p>
              <p className="text-xs text-muted-foreground mt-1">Convert NOE back to USDC anytime.</p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground/50 mt-4">
            NOE price = pool value / supply. When traders profit, pool decreases. Only deposit what you can afford to lose.
          </p>
        </div>
      </div>
    </div>
  );
}
