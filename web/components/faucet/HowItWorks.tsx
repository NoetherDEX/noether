'use client';

import { ArrowRight } from 'lucide-react';

export function HowItWorks() {
  const steps = [
    {
      number: '01',
      title: 'Trust USDC',
      description: 'Add USDC to your wallet trustline',
      color: '#8b5cf6',
    },
    {
      number: '02',
      title: 'Select Amount',
      description: 'Choose 100, 500, or 1000 USDC',
      color: '#3b82f6',
    },
    {
      number: '03',
      title: 'Receive USDC',
      description: 'Tokens sent to your wallet instantly',
      color: '#22c55e',
    },
  ];

  return (
    <div className="rounded-2xl border border-white/10 bg-card p-6 mb-6">
      <h2 className="text-base font-semibold text-foreground mb-6 text-center">
        How It Works
      </h2>
      <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-6">
        {steps.map((step, index) => (
          <div key={step.number} className="flex items-center gap-4 md:gap-6">
            <div className="flex flex-col items-center text-center">
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center mb-3 border"
                style={{
                  backgroundColor: `${step.color}10`,
                  borderColor: `${step.color}30`,
                }}
              >
                <span
                  className="text-lg font-bold"
                  style={{ color: step.color }}
                >
                  {step.number}
                </span>
              </div>
              <h3 className="font-medium text-foreground mb-1">{step.title}</h3>
              <p className="text-sm text-muted-foreground max-w-[150px]">
                {step.description}
              </p>
            </div>
            {index < steps.length - 1 && (
              <ArrowRight className="hidden md:block w-5 h-5 text-muted-foreground/30 flex-shrink-0" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
