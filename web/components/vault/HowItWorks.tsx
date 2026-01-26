'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, TrendingUp, Coins, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export function HowItWorks() {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-6 py-4 flex items-center justify-between border-b border-white/10 hover:bg-white/[0.02] transition-colors"
      >
        <h3 className="text-base font-semibold text-foreground">How It Works</h3>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-5 h-5 text-muted-foreground" />
        )}
      </button>

      <div
        className={cn(
          'overflow-hidden transition-all duration-300',
          isExpanded ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="p-6">
          {/* Steps */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {/* Step 1 */}
            <div className="relative p-5 rounded-xl bg-secondary/30 border border-white/5 group hover:border-[#8b5cf6]/30 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#8b5cf6]/10 border border-[#8b5cf6]/20 flex items-center justify-center mb-4">
                <span className="text-lg font-bold text-[#8b5cf6]">1</span>
              </div>
              <h4 className="font-semibold text-foreground mb-2">Deposit</h4>
              <p className="text-sm text-muted-foreground">
                Deposit USDC and receive NOE tokens representing your pool share.
              </p>
              <div className="hidden md:block absolute top-1/2 -right-3 transform -translate-y-1/2 z-10">
                <ArrowRight className="w-5 h-5 text-muted-foreground/30" />
              </div>
            </div>

            {/* Step 2 */}
            <div className="relative p-5 rounded-xl bg-secondary/30 border border-white/5 group hover:border-[#3b82f6]/30 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#3b82f6]/10 border border-[#3b82f6]/20 flex items-center justify-center mb-4">
                <span className="text-lg font-bold text-[#3b82f6]">2</span>
              </div>
              <h4 className="font-semibold text-foreground mb-2">Earn Fees</h4>
              <p className="text-sm text-muted-foreground">
                The pool earns 0.1% fee from every trade executed on the platform.
              </p>
              <div className="hidden md:block absolute top-1/2 -right-3 transform -translate-y-1/2 z-10">
                <ArrowRight className="w-5 h-5 text-muted-foreground/30" />
              </div>
            </div>

            {/* Step 3 */}
            <div className="p-5 rounded-xl bg-secondary/30 border border-white/5 group hover:border-[#22c55e]/30 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#22c55e]/10 border border-[#22c55e]/20 flex items-center justify-center mb-4">
                <span className="text-lg font-bold text-[#22c55e]">3</span>
              </div>
              <h4 className="font-semibold text-foreground mb-2">Withdraw</h4>
              <p className="text-sm text-muted-foreground">
                Withdraw anytime by converting NOE back to USDC at current pool value.
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-white/10 mb-6" />

          {/* GLP Model Explanation */}
          <div>
            <h4 className="font-semibold text-foreground mb-3">The GLP Model</h4>
            <p className="text-sm text-muted-foreground mb-4">
              As a liquidity provider, you become the counterparty to all trades on Noether.
              Your earnings come from:
            </p>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <div className="p-1.5 rounded-lg bg-[#22c55e]/10 mt-0.5">
                  <TrendingUp className="w-3.5 h-3.5 text-[#22c55e]" />
                </div>
                <span className="text-muted-foreground">
                  <strong className="text-foreground">Trading fees (0.1% per trade)</strong> - collected on every position opened
                </span>
              </li>
              <li className="flex items-start gap-3">
                <div className="p-1.5 rounded-lg bg-[#f59e0b]/10 mt-0.5">
                  <Coins className="w-3.5 h-3.5 text-[#f59e0b]" />
                </div>
                <span className="text-muted-foreground">
                  <strong className="text-foreground">Trader losses</strong> - when traders lose, LPs gain
                </span>
              </li>
            </ul>
            <p className="text-sm text-muted-foreground mt-4 p-3 bg-secondary/30 rounded-lg border border-white/5">
              The NOE token price reflects the pool&apos;s total value divided by circulating supply.
              As fees accumulate, NOE value grows.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
