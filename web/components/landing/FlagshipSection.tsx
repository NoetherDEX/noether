'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import { Coins, TrendingUp, Eye, Zap } from 'lucide-react';
import { LetterSpaced } from './animations';
import { useSlideContext } from './SlideContainer';
import { BrowserFrame } from './BrowserFrame';

const FEATURES = [
  {
    icon: Coins,
    title: 'Minimal Costs',
    description: 'No gas overhead — every trade settles at near-zero cost on Stellar.',
    side: 'left' as const,
  },
  {
    icon: TrendingUp,
    title: '10x Leverage',
    description: 'Amplify your edge with built-in margin on every perpetual pair.',
    side: 'left' as const,
  },
  {
    icon: Eye,
    title: 'Fully Onchain',
    description: 'Every order, match, and settlement lives on Soroban — verifiable by anyone.',
    side: 'right' as const,
  },
  {
    icon: Zap,
    title: 'Smart Orders',
    description: 'Stop-loss, take-profit, and limit orders — all native to the protocol.',
    side: 'right' as const,
  },
];

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

/* ── Feature Card ──────────────────────────────────────────── */
function FeatureCard({
  feature,
  align,
}: {
  feature: (typeof FEATURES)[number];
  align: 'left' | 'right';
}) {
  const Icon = feature.icon;
  const isRight = align === 'right';

  return (
    <div className={`flex gap-4 ${isRight ? 'flex-row-reverse text-right' : ''}`}>
      <div className="flex-shrink-0">
        <div className="w-12 h-12 rounded-xl border border-[#eab308]/20 flex items-center justify-center bg-[#eab308]/5">
          <Icon className="w-5 h-5 text-[#eab308]" strokeWidth={1.5} />
        </div>
      </div>
      <div>
        <h3 className="text-lg font-semibold mb-1">{feature.title}</h3>
        <p className="text-sm text-black/50 leading-relaxed">{feature.description}</p>
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

  const leftFeatures = FEATURES.filter((f) => f.side === 'left');
  const rightFeatures = FEATURES.filter((f) => f.side === 'right');

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

      {/* ── Desktop layout ────────────────────────────────── */}
      <div className="hidden lg:grid grid-cols-[1fr_2.5fr_1fr] gap-8 max-w-[1400px] mx-auto items-center w-full mt-8">
        {/* Left features */}
        <div className="flex flex-col gap-12 justify-center">
          {leftFeatures.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, x: -80 }}
              animate={{
                opacity: phase === 1 ? 1 : 0,
                x: phase === 1 ? 0 : -80,
              }}
              transition={{ duration: 0.65, delay: phase === 1 ? 0.1 + i * 0.1 : 0, ease }}
            >
              <FeatureCard feature={feature} align="right" />
            </motion.div>
          ))}
        </div>

        {/* Center screenshot */}
        <motion.div
          className="mt-4"
          initial={{ scale: 1.1 }}
          animate={{ scale: phase === 1 ? 1 : 1.1 }}
          transition={{ duration: 0.7, ease }}
        >
          <ScreenshotCard />
        </motion.div>

        {/* Right features */}
        <div className="flex flex-col gap-12 justify-center">
          {rightFeatures.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, x: 80 }}
              animate={{
                opacity: phase === 1 ? 1 : 0,
                x: phase === 1 ? 0 : 80,
              }}
              transition={{ duration: 0.65, delay: phase === 1 ? 0.1 + i * 0.1 : 0, ease }}
            >
              <FeatureCard feature={feature} align="left" />
            </motion.div>
          ))}
        </div>
      </div>

      {/* ── Mobile layout ─────────────────────────────────── */}
      <div className="lg:hidden w-full max-w-[600px] mx-auto mt-8">
        <motion.div
          className="mb-8"
          initial={{ scale: 1 }}
          animate={{ scale: phase === 1 ? 0.9 : 1 }}
          transition={{ duration: 0.65, ease }}
        >
          <ScreenshotCard />
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {FEATURES.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 30 }}
              animate={{
                opacity: phase === 1 ? 1 : 0,
                y: phase === 1 ? 0 : 30,
              }}
              transition={{ duration: 0.5, delay: phase === 1 ? 0.1 + i * 0.08 : 0, ease }}
            >
              <FeatureCard feature={feature} align="left" />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FlagshipFeaturesSection() {
  return null;
}
