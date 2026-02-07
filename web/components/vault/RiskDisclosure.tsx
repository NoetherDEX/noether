'use client';

export function RiskDisclosure() {
  return (
    <div className="rounded-2xl border border-white/10 bg-card p-6">
      <h4 className="text-sm font-medium text-[#f59e0b] mb-3">Risk Disclosure</h4>
      <p className="text-sm text-muted-foreground mb-3">
        Providing liquidity involves risk. As the counterparty to traders:
      </p>
      <ul className="space-y-1.5 text-sm text-muted-foreground mb-3">
        <li>When traders profit, the pool value decreases</li>
        <li>When traders lose, the pool value increases</li>
        <li>Your NOE tokens may be worth less USDC than you deposited</li>
      </ul>
      <p className="text-xs text-muted-foreground/60">
        Historical performance does not guarantee future results. Only deposit what you can afford to lose.
      </p>
    </div>
  );
}
