'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  motion,
  AnimatePresence,
  useScroll,
  useTransform,
  useMotionTemplate,
  useReducedMotion,
} from 'framer-motion';
import { FadeIn } from './animations';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { fetchTicker } from '@/lib/hooks/usePriceData';
import { formatUSD, formatPercent, priceDecimals } from '@/lib/utils';

/* ── Live markets: real Binance reference prices, refreshed every 10s.
     All 13 listed pairs; the panel scrolls. ── */
const MARKETS = [
  'BTC', 'ETH', 'XLM', 'SOL', 'XRP', 'ADA', 'BNB',
  'TRX', 'DOGE', 'ZEC', 'LINK', 'BCH', 'LTC',
] as const;

function LiveMarkets() {
  const [tickers, setTickers] = useState<
    Record<string, { price: number; change: number } | undefined>
  >({});

  useEffect(() => {
    let active = true;
    const load = () => {
      MARKETS.forEach((sym) => {
        fetchTicker(sym)
          .then((t) => {
            if (active)
              setTickers((prev) => ({
                ...prev,
                [sym]: { price: t.price, change: t.changePercent24h },
              }));
          })
          .catch(() => {});
      });
    };
    load();
    const id = setInterval(load, 10_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Live Markets
        </h2>
        <span className="w-1.5 h-1.5 rounded-full bg-long/80" aria-hidden="true" />
      </div>

      <div className="flex-1 max-h-[264px] overflow-y-auto custom-scrollbar pr-2">
        {MARKETS.map((sym) => {
          const t = tickers[sym];
          return (
            <Link
              key={sym}
              href="/trade"
              className="flex items-center gap-3 py-3 border-b border-border last:border-b-0 group"
            >
              <TokenIcon symbol={sym} size={22} />
              <span className="font-mono text-sm text-foreground group-hover:text-primary transition-colors">
                {sym}-PERP
              </span>
              <span className="ml-auto font-mono text-sm text-foreground tabular-nums">
                {t ? formatUSD(t.price, priceDecimals(sym)) : '—'}
              </span>
              <span
                className={`w-[4.5rem] text-right font-mono text-xs tabular-nums ${
                  !t ? 'text-faint' : t.change >= 0 ? 'text-long' : 'text-short'
                }`}
              >
                {t ? formatPercent(t.change) : ''}
              </span>
            </Link>
          );
        })}
      </div>

      <p className="mt-4 font-mono text-[10px] text-faint">
        Binance reference · execution settles at the Noeracle mark
      </p>
    </div>
  );
}

/* ── Floating terminal card: one fill, narrated step by step ── */
const FILL_STEPS = [
  { tag: 'Noeracle mark', body: 'BTC-PERP · mark 63,741.20 · streaming ~500ms' },
  { tag: 'Order', body: 'Long BTC-PERP · 2,400 USDC margin · 10x isolated' },
  { tag: 'Fill', body: 'Filled @ 63,742.05 · fee 0.05% · slippage 0.001%' },
  { tag: 'Settlement', body: 'Margin locked, position live on-chain ✓' },
];

function TerminalCard() {
  const prefersReducedMotion = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const id = setInterval(() => setStep((s) => (s + 1) % FILL_STEPS.length), 2600);
    return () => clearInterval(id);
  }, [prefersReducedMotion]);

  const active = FILL_STEPS[step];

  return (
    <div className="w-[360px] rounded-lg border border-white/10 bg-[#0B0D10]/70 backdrop-blur-md p-5">
      {/* Header */}
      <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-white/10">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Noether · Terminal
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-long">
          <span className="w-1 h-1 rounded-full bg-long" aria-hidden="true" />
          Live fill
        </span>
      </div>

      <div className="flex items-center justify-between gap-4 mb-4">
        <p className="font-mono text-[10px] text-faint tabular-nums shrink-0">
          {String(step + 1).padStart(2, '0')} / {String(FILL_STEPS.length).padStart(2, '0')}
        </p>
        {/* Single progress track — gold fill grows with each step */}
        <div className="relative h-px flex-1 bg-white/15 overflow-hidden" aria-hidden="true">
          <motion.span
            className="absolute left-0 top-0 h-full w-full origin-left bg-primary block"
            animate={{ scaleX: (step + 1) / FILL_STEPS.length }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* Active step */}
      <div className="min-h-[72px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary mb-2">
              ● {active.tag}
            </p>
            <p className="font-mono text-[13px] text-foreground/90 leading-relaxed">
              {active.body}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export function Hero() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  // Scroll choreography: the frame stays pinned while the edges press
  // inward and the corners round off — the video itself never rescales,
  // it's clipped into a card resting on the bone page frame. The last
  // stretch of the runway holds the settled card before the page moves on.
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end end'],
  });
  // Smaller press-in on narrow screens so the type never meets the clip edge.
  const [maxInset, setMaxInset] = useState({ top: 68, x: 44 });
  useEffect(() => {
    const update = () =>
      setMaxInset(window.innerWidth < 640 ? { top: 56, x: 14 } : { top: 68, x: 44 });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const insetTop = useTransform(scrollYProgress, [0, 0.7, 1], [0, maxInset.top, maxInset.top]);
  const insetX = useTransform(scrollYProgress, [0, 0.7, 1], [0, maxInset.x, maxInset.x]);
  const radius = useTransform(scrollYProgress, [0, 0.7, 1], [0, 32, 32]);
  const clipPath = useMotionTemplate`inset(${insetTop}px ${insetX}px ${insetX}px round ${radius}px)`;

  return (
    <>
      {/* ── Full-screen video hero — edges press in, corners round off ── */}
      <section ref={sectionRef} className="relative h-[150dvh] bg-[#E8E6E1]">
        <div className="sticky top-0 h-[100dvh] overflow-hidden">
          <motion.div
            style={prefersReducedMotion ? undefined : { clipPath }}
            className="relative w-full h-full overflow-hidden bg-surface [will-change:clip-path]"
          >
            <video
              className="hero-video absolute inset-0 w-full h-full object-cover blur-[3px] scale-105 brightness-[0.8]"
              src="/media/hero-loop.mp4"
              autoPlay
              muted
              loop
              playsInline
            />
            {/* Two washes: bottom-heavy for the type, left-leaning so the
                headline never fights the bright parts of the footage */}
            <div
              className="absolute inset-0 bg-gradient-to-t from-[#0B0D10]/95 via-[#0B0D10]/45 to-[#0B0D10]/20"
              aria-hidden="true"
            />
            <div
              className="absolute inset-0 bg-gradient-to-r from-[#0B0D10]/70 via-[#0B0D10]/20 to-transparent"
              aria-hidden="true"
            />

            {/* One shared baseline: type block left, terminal card right */}
            <div className="absolute inset-x-0 bottom-0 px-6 sm:px-14 pb-12 sm:pb-16">
              <div className="flex items-end justify-between gap-12">
                <div className="max-w-[760px]">
                  <FadeIn delay={0.05} immediate>
                    <h1 className="font-display font-normal tracking-[-0.015em] leading-[1.02] text-foreground text-[clamp(3.25rem,7.5vw,7rem)]">
                      The world based
                      <br />
                      on <em className="italic text-primary">leverage.</em>
                    </h1>
                  </FadeIn>
                  <FadeIn delay={0.2} immediate>
                    <div className="mt-9 flex flex-wrap items-center gap-3">
                      <Link
                        href="/trade"
                        className="inline-flex items-center gap-2 h-12 px-7 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
                      >
                        Launch App
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </Link>
                      <Link
                        href="/vaults"
                        className="inline-flex items-center h-12 px-7 rounded-full border border-white/20 bg-white/5 backdrop-blur-sm text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
                      >
                        Explore Vaults
                      </Link>
                    </div>
                  </FadeIn>
                </div>

                {/* Terminal card shares the composition's baseline */}
                <div className="hidden lg:block shrink-0 pb-1">
                  <FadeIn delay={0.35} immediate>
                    <TerminalCard />
                  </FadeIn>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Backed by — Stellar ecosystem ── */}
      <section className="bg-[#E8E6E1] text-[#0B0D10] border-t border-black/10 px-6 py-14">
        <p className="text-center font-mono text-[11px] uppercase tracking-[0.35em] text-black/45 mb-8">
          Backed by Stellar &amp; the Stellar Community Fund
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-14 gap-y-6 opacity-70">
          <span className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- small static brand mark */}
            <img src="/xlmlogo.svg" alt="" width="28" height="28" className="grayscale" aria-hidden="true" />
            <span className="text-xl font-semibold tracking-tight">Stellar</span>
          </span>
          <span className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- small static brand mark */}
            <img src="/xlmlogo.svg" alt="" width="28" height="28" className="grayscale" aria-hidden="true" />
            <span className="text-xl font-semibold tracking-tight">
              Stellar Community Fund
            </span>
          </span>
        </div>
      </section>

      {/* ── Color-block band: onboarding · live markets · gold CTA ── */}
      <section className="border-t border-border">
        <div className="grid lg:grid-cols-3 items-stretch">
          {/* Start in three moves — bone */}
          <div className="bg-[#E8E6E1] text-[#0B0D10] px-8 py-12">
            <h2 className="text-lg font-semibold tracking-[-0.01em] mb-5">
              Start in three moves
            </h2>
            <div>
              {[
                { n: '01', label: 'Connect your Stellar wallet', href: '/trade' },
                { n: '02', label: 'Claim testnet USDC from the faucet', href: '/faucet' },
                { n: '03', label: 'Open your first position', href: '/trade' },
              ].map((step) => (
                <Link
                  key={step.n}
                  href={step.href}
                  className="flex items-baseline gap-4 py-3.5 border-b border-black/10 last:border-b-0 group"
                >
                  <span className="font-mono text-[11px] text-black/40 tabular-nums">{step.n}</span>
                  <span className="text-[15px] font-medium text-black/80 group-hover:text-black transition-colors">
                    {step.label}
                  </span>
                  <span
                    className="ml-auto font-mono text-xs text-black/35 group-hover:text-black transition-colors"
                    aria-hidden="true"
                  >
                    ↳
                  </span>
                </Link>
              ))}
            </div>
          </div>

          {/* Live markets — dark */}
          <div className="bg-background px-8 py-12 border-y lg:border-y-0 lg:border-x border-border">
            <LiveMarkets />
          </div>

          {/* Gold CTA — a notch calmer than the accent gold so the slab doesn't glare */}
          <Link
            href="/trade"
            className="group flex flex-col justify-between gap-10 bg-[#DCA82B] text-primary-foreground px-8 py-12 min-h-[280px] transition-colors duration-300 hover:bg-[#D2A027]"
          >
            <svg
              width="44"
              height="44"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className="transition-transform group-hover:translate-x-1 group-hover:-translate-y-1"
            >
              <path d="M6 18L18 6M9 6h9v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="font-heading text-2xl sm:text-3xl font-semibold tracking-[-0.02em]">
              Step into the terminal.
            </span>
          </Link>
        </div>
      </section>
    </>
  );
}
