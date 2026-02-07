'use client';

import { useSlideContext } from './SlideContainer';

/* ════════════════════════════════════════════════════════════
   NOEIntroSection — Text-reveal intro before VaultSection

   data-phases="3" → 3 internal phases (0, 1, 2)
   Phase 0: dim white text
   Phase 1: gold fills ~50% from left
   Phase 2: gold fills 100%
   Then next scroll → VaultSection
   ════════════════════════════════════════════════════════════ */
export function NOEIntroSection() {
  const { noeIntroPhase: phase } = useSlideContext();

  // Gold wipe: clipPath inset right side shrinks as phase increases
  const rightClip = phase === 0 ? 100 : phase === 1 ? 45 : 0;

  return (
    <section
      data-phases="3"
      className="snap-section section-dark flex items-center justify-center px-6"
    >
      <div className="relative max-w-[800px] mx-auto text-center">
        {/* Base text — dim white */}
        <h2 className="text-3xl md:text-5xl lg:text-[3.5rem] font-heading font-bold tracking-[-0.02em] leading-[1.2] text-white/20">
          Introducing the{' '}
          <span className="italic">NOE</span> token
          <br className="hidden md:block" />{' '}
          for liquidity providers
        </h2>

        {/* Gold overlay — clipped from left to right */}
        <h2
          className="absolute inset-0 text-3xl md:text-5xl lg:text-[3.5rem] font-heading font-bold tracking-[-0.02em] leading-[1.2] text-[#eab308]"
          style={{
            clipPath: `inset(0 ${rightClip}% 0 0)`,
            transition: 'clip-path 0.8s cubic-bezier(0.25, 0.1, 0.25, 1)',
          }}
        >
          Introducing the{' '}
          <span className="italic">NOE</span> token
          <br className="hidden md:block" />{' '}
          for liquidity providers
        </h2>
      </div>
    </section>
  );
}
