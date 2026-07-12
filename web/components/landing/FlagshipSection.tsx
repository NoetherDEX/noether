'use client';

import Link from 'next/link';
import { FadeIn } from './animations';
import { cn } from '@/lib/utils/cn';

/* ── Wireframe illustrations — stroke-only, inherit currentColor ── */
function GlobeWire() {
  return (
    <svg viewBox="0 0 200 200" width="180" height="180" fill="none" aria-hidden="true" className="opacity-60">
      <circle cx="100" cy="100" r="88" stroke="currentColor" strokeWidth="1" />
      <ellipse cx="100" cy="100" rx="88" ry="34" stroke="currentColor" strokeWidth="1" />
      <ellipse cx="100" cy="100" rx="88" ry="64" stroke="currentColor" strokeWidth="1" />
      <ellipse cx="100" cy="100" rx="34" ry="88" stroke="currentColor" strokeWidth="1" />
      <ellipse cx="100" cy="100" rx="64" ry="88" stroke="currentColor" strokeWidth="1" />
      <line x1="12" y1="100" x2="188" y2="100" stroke="currentColor" strokeWidth="1" />
      <circle cx="128" cy="56" r="3" fill="currentColor" />
    </svg>
  );
}

function DotSphere() {
  return (
    <svg viewBox="0 0 200 200" width="180" height="180" fill="none" aria-hidden="true" className="opacity-60">
      {[16, 34, 52, 68, 82].map((ry, i) => (
        <ellipse
          key={ry}
          cx="100"
          cy="100"
          rx={88 - i * 4}
          ry={ry}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="0.5 7"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

function Starburst() {
  return (
    <svg viewBox="0 0 200 200" width="180" height="180" fill="none" aria-hidden="true" className="opacity-60">
      {Array.from({ length: 24 }, (_, i) => {
        const a = (i * Math.PI) / 12;
        const inner = i % 2 === 0 ? 14 : 30;
        return (
          <line
            key={i}
            x1={100 + inner * Math.cos(a)}
            y1={100 + inner * Math.sin(a)}
            x2={100 + 88 * Math.cos(a)}
            y2={100 + 88 * Math.sin(a)}
            stroke="currentColor"
            strokeWidth="1"
          />
        );
      })}
    </svg>
  );
}

function GridPlane() {
  return (
    <svg viewBox="0 0 200 200" width="180" height="180" fill="none" aria-hidden="true" className="opacity-60">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <line key={`v${i}`} x1={20 + i * 26.6} y1="150" x2={72 + i * 9.3} y2="58" stroke="currentColor" strokeWidth="1" />
      ))}
      {[0, 1, 2, 3, 4].map((i) => (
        <line
          key={`h${i}`}
          x1={20 + i * 13}
          y1={150 - i * 23}
          x2={180 - i * 13}
          y2={150 - i * 23}
          stroke="currentColor"
          strokeWidth="1"
        />
      ))}
      <circle cx="100" cy="104" r="3" fill="currentColor" />
    </svg>
  );
}

/* ── Feature panels — hard color blocks, alternating ink/bone ── */
const FEATURES = [
  {
    art: <GlobeWire />,
    title: 'Perpetuals',
    description:
      'BTC, ETH & XLM perpetual futures, USDC-margined with up to 10x leverage and transparent hourly funding.',
    href: '/trade',
    dark: true,
  },
  {
    art: <DotSphere />,
    title: 'Fully On-Chain',
    description:
      'No off-chain matcher to trust — orders, margin, and settlement all live in Soroban contracts, verifiable by anyone.',
    href: '/trade',
    dark: false,
  },
  {
    art: <Starburst />,
    title: 'Copy-Trading Vaults',
    description:
      'Back a proven leader with USDC or run a vault of your own. PnL splits settle through the vault factory.',
    href: '/vaults',
    dark: true,
  },
  {
    art: <GridPlane />,
    title: 'Smart Orders',
    description:
      'Stop-loss, take-profit, limit, stop-limit, and trailing stops — triggered by the same oracle that settles you.',
    href: '/trade',
    dark: false,
  },
];

export function FlagshipSection() {
  return (
    <section className="bg-background border-t border-border">
      {/* Display heading */}
      <div className="px-6 sm:px-10 py-20 lg:py-24">
        <FadeIn>
          <h2 className="font-display font-normal tracking-[-0.01em] leading-[0.95] text-foreground text-[clamp(3rem,8vw,6.5rem)]">
            Engineered
            <br />
            <em className="italic text-primary">for proof.</em>
          </h2>
          <p className="mt-6 text-sm text-muted-foreground max-w-[480px] leading-relaxed [text-wrap:balance]">
            Her theorem proves that symmetry guards truth. Our exchange guards
            yours — every invariant enforced by contract, every fill provable.
          </p>
        </FadeIn>
      </div>

      {/* Color-blocked panels */}
      <div className="grid md:grid-cols-2 xl:grid-cols-4 border-t border-border">
        {FEATURES.map((feature) => (
          <Link
            key={feature.title}
            href={feature.href}
            className={cn(
              'group flex flex-col p-8 min-h-[480px] border-b xl:border-b-0 border-border md:[&:nth-child(odd)]:border-r xl:border-r xl:last:border-r-0',
              feature.dark
                ? 'bg-background text-foreground'
                : 'bg-[#E8E6E1] text-[#0B0D10]'
            )}
          >
            <div className={cn('flex-1 flex items-center justify-center py-8', feature.dark ? 'text-primary' : 'text-black/70')}>
              {feature.art}
            </div>
            <h3 className="text-2xl font-semibold tracking-[-0.01em] mb-3">{feature.title}</h3>
            <p
              className={cn(
                'font-mono text-[11px] uppercase tracking-[0.08em] leading-relaxed mb-8',
                feature.dark ? 'text-muted-foreground' : 'text-black/60'
              )}
            >
              {feature.description}
            </p>
            <span
              className={cn(
                'w-max rounded-full border px-5 py-2 font-mono text-[11px] uppercase tracking-[0.15em] transition-colors',
                feature.dark
                  ? 'border-border-strong text-muted-foreground group-hover:border-primary/50 group-hover:text-primary'
                  : 'border-black/25 text-black/70 group-hover:border-black group-hover:text-black'
              )}
            >
              Explore
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function FlagshipFeaturesSection() {
  return null;
}
