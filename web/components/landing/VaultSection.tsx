'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { FadeIn } from './animations';

/* ── Flow steps with webm motion designs ──────────────────── */
const STEPS = [
  {
    video: '/out/deposit-usdc.webm',
    label: 'Deposit USDC',
    borderColor: 'rgba(38, 161, 241, 0.4)',
    glowColor: 'rgba(38, 161, 241, 0.1)',
  },
  {
    video: '/out/vault-processing.webm',
    label: 'Vault',
    borderColor: 'rgba(234, 179, 8, 0.4)',
    glowColor: 'rgba(234, 179, 8, 0.1)',
  },
  {
    video: '/out/receive-noe.webm',
    label: 'Receive NOE',
    borderColor: 'rgba(34, 197, 94, 0.4)',
    glowColor: 'rgba(34, 197, 94, 0.1)',
  },
];

const ease = [0.25, 0.1, 0.25, 1] as const;

/* ── Dashed gold connector ────────────────────────────────── */
function HorizontalConnector() {
  return (
    <div className="hidden sm:flex items-center px-2 md:px-4 -mt-6">
      <svg width="48" height="2" viewBox="0 0 48 2" className="overflow-visible">
        <line
          x1="0" y1="1" x2="48" y2="1"
          stroke="rgba(234,179,8,0.3)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        <polygon points="44,0 48,1 44,2" fill="rgba(234,179,8,0.5)" />
      </svg>
    </div>
  );
}

function VerticalConnector() {
  return (
    <div className="sm:hidden flex justify-center py-2">
      <svg width="2" height="32" viewBox="0 0 2 32" className="overflow-visible">
        <line
          x1="1" y1="0" x2="1" y2="28"
          stroke="rgba(234,179,8,0.3)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        <polygon points="0,28 1,32 2,28" fill="rgba(234,179,8,0.5)" />
      </svg>
    </div>
  );
}

/* ── Video card with glow ─────────────────────────────────── */
function FlowCard({
  step,
  index,
}: {
  step: (typeof STEPS)[number];
  index: number;
}) {
  return (
    <motion.div
      className="flex flex-col items-center gap-3"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, delay: 0.3 + index * 0.15, ease }}
    >
      <div
        className="w-[160px] h-[160px] md:w-[220px] md:h-[220px] lg:w-[260px] lg:h-[260px] rounded-[28px] overflow-hidden"
        style={{
          border: `1.5px solid ${step.borderColor}`,
          boxShadow: `0 0 30px ${step.glowColor}, 0 0 60px ${step.glowColor}`,
          background: '#08080c',
        }}
      >
        <video
          src={step.video}
          autoPlay
          loop
          muted
          playsInline
          className="w-full h-full object-contain scale-[1.8]"
        />
      </div>
      <span className="text-[13px] md:text-sm font-medium text-white/50 tracking-wide">
        {step.label}
      </span>
    </motion.div>
  );
}

export function VaultSection() {
  return (
    <section className="snap-section section-dark flex flex-col items-center justify-center px-6 relative">
      {/* Subtle radial glow */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(234,179,8,0.03) 0%, transparent 70%)',
        }}
      />

      <div className="relative z-10 max-w-[1100px] mx-auto text-center">
        {/* Heading */}
        <FadeIn delay={0.2}>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-heading font-bold tracking-[-0.02em] leading-[1.05] mb-8 md:mb-10">
            Earn Yield with{' '}
            <span className="text-[#22c55e]">NOE</span>
          </h2>
        </FadeIn>

        {/* ── Flow diagram with video cards ───────────────── */}
        <div className="flex flex-col sm:flex-row items-center sm:items-start justify-center mb-8 md:mb-10">
          {STEPS.map((step, i) => (
            <div key={step.label} className="flex flex-col sm:flex-row items-center">
              <FlowCard step={step} index={i} />
              {i < STEPS.length - 1 && (
                <>
                  <HorizontalConnector />
                  <VerticalConnector />
                </>
              )}
            </div>
          ))}
        </div>

        {/* CTA */}
        <FadeIn delay={0.7}>
          <Link href="/vault" className="pill-button pill-button-filled text-sm">
            Deposit Now
          </Link>
        </FadeIn>
      </div>
    </section>
  );
}
