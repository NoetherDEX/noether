'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Coins, TrendingUp, Wallet } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import { cn } from '@/lib/utils/cn';

export function HowItWorks() {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <Card>
      <CardHeader>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center justify-between w-full text-left"
        >
          <CardTitle>How It Works</CardTitle>
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-neutral-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-neutral-400" />
          )}
        </button>
      </CardHeader>

      <div
        className={cn(
          'overflow-hidden transition-all duration-300',
          isExpanded ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <CardContent className="pt-0">
          {/* Steps */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="p-4 bg-white/5 rounded-xl">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center mb-3">
                <span className="text-lg font-bold text-emerald-400">1</span>
              </div>
              <h4 className="font-medium text-white mb-2">Deposit</h4>
              <p className="text-sm text-neutral-400">
                Deposit USDC and receive NOE tokens representing your pool share.
              </p>
            </div>

            <div className="p-4 bg-white/5 rounded-xl">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center mb-3">
                <span className="text-lg font-bold text-blue-400">2</span>
              </div>
              <h4 className="font-medium text-white mb-2">Earn Fees</h4>
              <p className="text-sm text-neutral-400">
                The pool earns 0.1% fee from every trade executed on the platform.
              </p>
            </div>

            <div className="p-4 bg-white/5 rounded-xl">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center mb-3">
                <span className="text-lg font-bold text-amber-400">3</span>
              </div>
              <h4 className="font-medium text-white mb-2">Withdraw</h4>
              <p className="text-sm text-neutral-400">
                Withdraw anytime by converting NOE back to USDC at current pool value.
              </p>
            </div>
          </div>

          {/* GLP Model Explanation */}
          <div className="h-px bg-white/10 mb-6" />

          <div>
            <h4 className="font-medium text-white mb-3">The GLP Model</h4>
            <p className="text-sm text-neutral-400 mb-4">
              As a liquidity provider, you become the counterparty to all trades on Noether.
              Your earnings come from:
            </p>
            <ul className="space-y-2 text-sm text-neutral-400">
              <li className="flex items-start gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span><strong className="text-white">Trading fees (0.1% per trade)</strong> - collected on every position opened</span>
              </li>
              <li className="flex items-start gap-2">
                <Coins className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <span><strong className="text-white">Trader losses</strong> - when traders lose, LPs gain</span>
              </li>
            </ul>
            <p className="text-sm text-neutral-400 mt-4">
              The NOE token price reflects the pool&apos;s total value divided by circulating supply.
              As fees accumulate, NOE value grows.
            </p>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}
