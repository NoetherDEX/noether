'use client';

import { useEffect, useRef } from 'react';

const steps = [
  {
    number: 1,
    title: 'Visit Faucet',
    description: 'Get testnet tokens to start trading on Stellar Testnet.',
  },
  {
    number: 2,
    title: 'Add USDC Trustline',
    description: 'Enable USDC in your Stellar wallet to deposit funds.',
  },
  {
    number: 3,
    title: 'Start Trading',
    description: "Open positions with up to 10x leverage. That's it!",
  },
];

export function GettingStarted() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      },
      { threshold: 0.1 }
    );

    const elements = sectionRef.current?.querySelectorAll('.reveal');
    elements?.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="py-24 px-8 relative z-[1]">
      <div className="max-w-[1200px] mx-auto">
        {/* Section Header */}
        <div className="text-center mb-16 reveal">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#eab308] mb-4">
            Getting Started
          </p>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Start in 3 Simple Steps
          </h2>
        </div>

        {/* Steps */}
        <div className="flex items-start justify-center gap-4 flex-wrap reveal">
          {steps.map((step, index) => (
            <>
              <div
                key={step.number}
                className="step-card flex-1 min-w-[220px] max-w-[300px] p-8 bg-white/[0.02] border border-white/[0.06] rounded-2xl text-center transition-all duration-300"
              >
                <div className="w-10 h-10 flex items-center justify-center bg-gradient-to-br from-[#eab308] to-[#22c55e] rounded-full font-bold text-black mx-auto mb-6">
                  {step.number}
                </div>
                <h3 className="text-base font-semibold mb-2">{step.title}</h3>
                <p className="text-sm text-white/60">{step.description}</p>
              </div>
              {index < steps.length - 1 && (
                <div
                  key={`connector-${step.number}`}
                  className="hidden md:block w-10 h-0.5 bg-gradient-to-r from-[#eab308] to-[#22c55e] self-center mt-8"
                />
              )}
            </>
          ))}
        </div>
      </div>
    </section>
  );
}
