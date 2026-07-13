'use client';

export function RiskDisclosure() {
  return (
    <div className="border-l-2 border-primary/60 pl-3">
      <h4 className="text-xs font-medium text-primary mb-2">Risk Disclosure</h4>
      <p className="text-xs text-muted-foreground mb-2">
        Providing liquidity involves risk. As the counterparty to traders:
      </p>
      <ul className="space-y-1 text-xs text-muted-foreground mb-2">
        <li>When traders profit, the pool value decreases</li>
        <li>When traders lose, the pool value increases</li>
        <li>Your NOE tokens may be worth less USDC than you deposited</li>
      </ul>
      <p className="text-xs text-faint">
        Historical performance does not guarantee future results. Only deposit what you can afford to lose.
      </p>
    </div>
  );
}
