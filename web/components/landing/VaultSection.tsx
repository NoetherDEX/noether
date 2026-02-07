'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  CircleDot,
  Infinity as InfinityIcon,
  Percent,
  ArrowDownUp,
} from 'lucide-react';
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

const BENEFITS = [
  { icon: CircleDot, label: 'NOE = Your pool share', color: '#22c55e' },
  { icon: InfinityIcon, label: 'Fixed supply, no inflation', color: '#eab308' },
  { icon: Percent, label: 'Yield from fees & losses', color: '#22c55e' },
  { icon: ArrowDownUp, label: 'Withdraw anytime', color: '#eab308' },
];

const ease = [0.25, 0.1, 0.25, 1] as const;

/* ── Dashed gold connector ────────────────────────────────── */
function Connector() {
  return (
    <div className="flex items-center px-2 md:px-4 -mt-6">
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
        {/* Eyebrow */}
        <FadeIn delay={0.1}>
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-[#eab308]/60 mb-4">
            For Liquidity Providers
          </p>
        </FadeIn>

        {/* Heading */}
        <FadeIn delay={0.2}>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-heading font-bold tracking-[-0.02em] leading-[1.05] mb-4">
            Earn Yield with{' '}
            <span className="text-[#eab308]">NOE</span>
          </h2>
        </FadeIn>

        {/* Description */}
        <FadeIn delay={0.35}>
          <p className="text-sm md:text-base text-white/35 max-w-[460px] mx-auto leading-relaxed mb-6">
            Deposit USDC into the vault, receive NOE tokens representing
            your share. Earn yield from trading fees and trader losses.
          </p>
        </FadeIn>

        {/* ── Flow diagram with video cards ───────────────── */}
        <div className="flex items-start justify-center mb-6">
          {STEPS.map((step, i) => (
            <div key={step.label} className="flex items-center">
              <FlowCard step={step} index={i} />
              {i < STEPS.length - 1 && <Connector />}
            </div>
          ))}
        </div>

        {/* ── Benefits grid ───────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2.5 max-w-[520px] mx-auto mb-6">
          {BENEFITS.map((benefit, i) => {
            const Icon = benefit.icon;
            return (
              <motion.div
                key={benefit.label}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.4, delay: 0.5 + i * 0.06, ease }}
                className="flex items-center gap-2.5 px-4 py-3 rounded-lg text-sm relative overflow-hidden"
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <Icon
                  className="w-3.5 h-3.5 flex-shrink-0"
                  style={{ color: benefit.color, opacity: 0.7 }}
                  strokeWidth={1.5}
                />
                <span className="text-white/45 text-[12px]">{benefit.label}</span>
              </motion.div>
            );
          })}
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
