'use client';

import { useEffect, useRef } from 'react';

const benefits = [
  'NOE = Your pool share',
  'Fixed supply, no inflation',
  'Yield from fees & losses',
  'Withdraw anytime',
];

export function VaultSection() {
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
    <section
      ref={sectionRef}
      className="py-24 px-8 relative z-[1]"
      style={{
        background: 'linear-gradient(180deg, transparent, rgba(34, 197, 94, 0.03), transparent)',
      }}
    >
      <div className="max-w-[1200px] mx-auto">
        {/* Section Header */}
        <div className="text-center mb-16 reveal">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#eab308] mb-4">
            For Liquidity Providers
          </p>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Earn Yield with NOE
          </h2>
        </div>

        {/* Vault Flow */}
        <div className="flex items-center justify-center gap-8 flex-wrap mb-12 reveal">
          <div className="flex flex-col items-center gap-3 px-8 py-6 bg-white/[0.02] border border-white/[0.06] rounded-xl min-w-[140px]">
            <span className="text-3xl">$</span>
            <span className="font-semibold text-sm">Deposit USDC</span>
          </div>
          <span className="text-white/40 text-2xl">→</span>
          <div className="flex flex-col items-center gap-3 px-8 py-6 bg-white/[0.02] border border-white/[0.06] rounded-xl min-w-[140px]">
            <span className="text-3xl">◈</span>
            <span className="font-semibold text-sm">Vault</span>
          </div>
          <span className="text-white/40 text-2xl">→</span>
          <div className="flex flex-col items-center gap-3 px-8 py-6 bg-white/[0.02] border border-white/[0.06] rounded-xl min-w-[140px]">
            <span className="text-3xl text-[#22c55e]">◉</span>
            <span className="font-semibold text-sm">Receive NOE</span>
          </div>
        </div>

        {/* Benefits Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-[800px] mx-auto reveal">
          {benefits.map((benefit) => (
            <div
              key={benefit}
              className="flex items-center gap-3 px-6 py-4 bg-white/[0.02] border border-white/[0.06] rounded-lg text-sm"
            >
              <span className="text-[#22c55e] font-bold">✓</span>
              {benefit}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
