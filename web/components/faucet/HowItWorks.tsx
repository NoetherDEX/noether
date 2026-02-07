'use client';

export function HowItWorks() {
  const steps = [
    { label: 'First', title: 'Trust USDC', desc: 'Add USDC to your wallet trustline' },
    { label: 'Then', title: 'Select Amount', desc: 'Choose 100, 500, or 1000 USDC' },
    { label: 'Done', title: 'Receive USDC', desc: 'Tokens sent to your wallet instantly' },
  ];

  return (
    <div className="grid grid-cols-3 gap-4">
      {steps.map((step, i) => (
        <div key={i} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
          <span className="text-xs text-[#eab308] font-medium">{step.label}</span>
          <p className="text-base font-semibold text-foreground mt-2">{step.title}</p>
          <p className="text-sm text-muted-foreground mt-1">{step.desc}</p>
        </div>
      ))}
    </div>
  );
}
