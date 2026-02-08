'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import { LetterSpaced } from './animations';
import { useSlideContext } from './SlideContainer';
import { BrowserFrame } from './BrowserFrame';

/* ── Screenshot with gold glow ──────────────────────────────── */
function ScreenshotCard() {
  return (
    <div className="relative">
      <div
        className="relative rounded-2xl overflow-hidden bg-[#0a0a0a]"
        style={{
          border: '1.5px solid rgba(234, 179, 8, 0.6)',
          boxShadow:
            '0 0 0 1px rgba(234, 179, 8, 0.3), ' +
            '0 0 6px 1px rgba(234, 179, 8, 0.5), ' +
            '0 0 14px 2px rgba(234, 179, 8, 0.3), ' +
            '0 8px 24px rgba(0, 0, 0, 0.2)',
        }}
      >
        <div className="aspect-[16/8] w-full">
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
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   FlagshipSection — Two-phase presentation slide

   Phase is controlled by SlideContainer (fullpage controller).
   data-phases="2" tells the controller this section has
   2 internal phases before allowing navigation to the next slide.
   ════════════════════════════════════════════════════════════ */
export function FlagshipSection() {
  const { flagshipPhase: phase } = useSlideContext();

  const ease = [0.25, 0.1, 0.25, 1] as const;

  return (
    <section
      data-phases="2"
      className="snap-section section-light flex flex-col items-center justify-center px-6 overflow-hidden"
    >
      {/* Heading */}
      <div className="mt-[-2vh]">
        <h2 className="text-xl md:text-2xl lg:text-3xl font-heading font-semibold text-center max-w-[900px] mx-auto">
          <span>She proved every symmetry guards a deeper truth. We built an exchange that guards yours — fully </span>
          <LetterSpaced text="DECENTRALIZED" color="#eab308" className="font-bold" delay={0.3} />
        </h2>
      </div>

      {/* Screenshot */}
      <motion.div
        className="w-full max-w-[900px] mx-auto mt-8"
        initial={{ scale: 1.1, opacity: 0.8 }}
        animate={{
          scale: phase === 1 ? 1 : 1.1,
          opacity: phase === 1 ? 1 : 0.8,
        }}
        transition={{ duration: 0.7, ease }}
      >
        <ScreenshotCard />
      </motion.div>
    </section>
  );
}

export function FlagshipFeaturesSection() {
  return null;
}
