'use client';

import { useEffect, useRef } from 'react';

const features = [
  {
    icon: '10×',
    title: 'Up to 10x Leverage',
    description: 'Amplify your positions with up to 10x leverage on perpetual contracts.',
  },
  {
    icon: '◎',
    title: 'Advanced Orders',
    description: 'Limit orders, stop-loss, and take-profit to execute your strategy precisely.',
  },
  {
    icon: '△',
    title: 'Three Assets',
    description: 'Trade perpetuals on BTC, ETH, and XLM with deep liquidity.',
  },
  {
    icon: '◧',
    title: 'Portfolio Analytics',
    description: 'Clean, intuitive dashboard to track and analyze your positions.',
  },
];

export function TradersSection() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry, index) => {
          if (entry.isIntersecting) {
            setTimeout(() => {
              entry.target.classList.add('visible');
            }, index * 100);
          }
        });
      },
      { threshold: 0.1 }
    );

    const elements = sectionRef.current?.querySelectorAll('.reveal, .feature-card');
    elements?.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="py-24 px-8 relative z-[1]">
      <div className="max-w-[1200px] mx-auto">
        {/* Section Header */}
        <div className="text-center mb-16 reveal">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#eab308] mb-4">
            For Traders
          </p>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            Powerful Trading Tools
          </h2>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="feature-card p-8 bg-white/[0.02] border border-white/[0.06] rounded-2xl"
            >
              <div className="w-12 h-12 flex items-center justify-center bg-[#eab308]/10 rounded-xl mb-6 text-2xl">
                {feature.icon}
              </div>
              <h3 className="text-lg font-semibold mb-3">{feature.title}</h3>
              <p className="text-sm text-white/60 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
