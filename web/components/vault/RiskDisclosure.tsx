'use client';

import { AlertTriangle } from 'lucide-react';

export function RiskDisclosure() {
  return (
    <div className="p-4 bg-amber-500/5 border-l-4 border-amber-500/50 rounded-r-xl">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="text-sm font-medium text-amber-400 mb-2">Risk Disclosure</h4>
          <p className="text-sm text-neutral-400 mb-3">
            Providing liquidity involves risk. As the counterparty to traders:
          </p>
          <ul className="space-y-1 text-sm text-neutral-400">
            <li>• When traders profit, the pool value decreases</li>
            <li>• When traders lose, the pool value increases</li>
            <li>• Your NOE tokens may be worth less USDC than you deposited</li>
          </ul>
          <p className="text-sm text-neutral-500 mt-3">
            Historical performance does not guarantee future results. Only deposit what you can afford to lose.
          </p>
        </div>
      </div>
    </div>
  );
}
