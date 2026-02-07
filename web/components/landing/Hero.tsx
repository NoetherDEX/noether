'use client';

import Link from 'next/link';
import Image from 'next/image';
import { HeroBlobs } from './HeroBlobs';
import { TextReveal, FadeIn } from './animations';
import { BrowserFrame } from './BrowserFrame';

export function Hero() {
  return (
    <section className="snap-section section-dark flex flex-col items-center justify-center px-6 relative">
      <HeroBlobs />

      <div className="relative z-10 text-center max-w-[900px] mx-auto -mt-[22vh]">
        <h1 className="font-heading text-3xl md:text-4xl lg:text-5xl font-semibold tracking-[-0.02em] leading-[1.15] mb-5">
          <TextReveal text="Decentralized" delay={0.2} />
          <br />
          <span className="text-[#eab308]">
            <TextReveal text="Perpetual Trading" delay={0.4} />
          </span>
        </h1>

        <FadeIn delay={0.6}>
          <p className="text-sm md:text-base text-white/50 max-w-[440px] mx-auto leading-relaxed mb-8">
            Trade BTC, ETH & XLM perpetuals with up to 10x leverage.
            Powered by Soroban smart contracts on Stellar.
          </p>
        </FadeIn>

        <FadeIn delay={0.8}>
          <Link
            href="/trade"
            className="inline-flex items-center gap-2.5 px-7 py-3 rounded-full border border-white/20 text-white text-sm font-medium tracking-wide hover:border-[#eab308]/60 hover:text-[#eab308] transition-all duration-300"
          >
            Start Trading
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
        </FadeIn>
      </div>

      <FadeIn delay={1.0} className="absolute bottom-0 left-0 right-0 z-10 flex justify-center px-4">
        <div
          className="max-w-[950px] w-full rounded-t-2xl overflow-hidden bg-[#0a0a0a]"
          style={{
            borderTop: '1.5px solid rgba(234, 179, 8, 0.5)',
            borderLeft: '1.5px solid rgba(234, 179, 8, 0.5)',
            borderRight: '1.5px solid rgba(234, 179, 8, 0.5)',
            boxShadow:
              '0 0 6px 1px rgba(234, 179, 8, 0.4), ' +
              '0 0 14px 2px rgba(234, 179, 8, 0.2), ' +
              '0 -8px 30px rgba(234, 179, 8, 0.1)',
          }}
        >
          <div className="h-[36vh] w-full">
            <BrowserFrame>
              <Image
                src="/images/trading-screenshot.png"
                alt="Noether Trading Interface"
                fill
                className="object-cover object-top"
                priority
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  target.parentElement!.innerHTML = `
                    <div class="flex items-center justify-center w-full h-full bg-[#0a0a0a] text-white/20 text-lg font-mono">
                      Trading Interface Preview
                    </div>
                  `;
                }}
              />
            </BrowserFrame>
          </div>
        </div>
      </FadeIn>
    </section>
  );
}
