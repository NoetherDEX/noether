'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';

export function CompetitionBanner() {
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
    <div ref={sectionRef} className="max-w-[1200px] mx-auto px-8 relative z-[1]">
      <div
        className="reveal rounded-3xl p-16 text-center border border-white/[0.06]"
        style={{
          background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.05), rgba(34, 197, 94, 0.05))',
        }}
      >
        <p className="shiny-text text-5xl md:text-7xl lg:text-[5rem] font-bold mb-4">
          $20,000
        </p>
        <h2 className="text-2xl font-semibold mb-3">Trading Competition</h2>
        <p className="text-white/60 mb-8">
          Compete for rewards based on your trading volume. The more you trade, the more you earn.
        </p>
        <Link
          href="/leaderboard"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold bg-[#eab308] text-black hover:bg-[#fbbf24] hover:-translate-y-0.5 transition-all"
        >
          Join Competition
        </Link>
      </div>
    </div>
  );
}
