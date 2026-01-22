'use client';

import { ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui';

export function HowItWorks() {
  const steps = [
    {
      number: '01',
      title: 'Trust USDC',
      description: 'Add USDC to your wallet trustline',
    },
    {
      number: '02',
      title: 'Select Amount',
      description: 'Choose 100, 500, or 1000 USDC',
    },
    {
      number: '03',
      title: 'Receive USDC',
      description: 'Tokens sent to your wallet instantly',
    },
  ];

  return (
    <Card className="mb-8">
      <CardContent className="py-6">
        <h2 className="text-lg font-semibold text-white mb-6 text-center">
          How It Works
        </h2>
        <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-6">
          {steps.map((step, index) => (
            <div key={step.number} className="flex items-center gap-4 md:gap-6">
              <div className="flex flex-col items-center text-center">
                <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-3">
                  <span className="text-lg font-bold text-white">
                    {step.number}
                  </span>
                </div>
                <h3 className="font-medium text-white mb-1">{step.title}</h3>
                <p className="text-sm text-neutral-500 max-w-[150px]">
                  {step.description}
                </p>
              </div>
              {index < steps.length - 1 && (
                <ArrowRight className="hidden md:block w-5 h-5 text-neutral-600 flex-shrink-0" />
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
