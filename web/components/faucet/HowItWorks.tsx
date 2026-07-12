'use client';

export function HowItWorks() {
  const steps = [
    { num: '01', title: 'Trust USDC', desc: 'Add USDC to your wallet trustline' },
    { num: '02', title: 'Select amount', desc: 'Choose 100, 500, or 1000 USDC' },
    { num: '03', title: 'Receive', desc: 'Tokens sent to your wallet in seconds' },
  ];

  return (
    <div className="rounded-md border border-border bg-surface grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
      {steps.map((step) => (
        <div key={step.num} className="flex items-baseline gap-3 px-4 py-3 min-w-0">
          <span className="flex-none font-mono text-[11px] tabular-nums text-primary">
            {step.num}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{step.title}</p>
            <p className="text-[11px] text-faint truncate">{step.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
