'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { IS_MAINNET_BUILD } from '@/lib/utils/constants';
import {
  motion,
  AnimatePresence,
  useScroll,
  useTransform,
  useMotionTemplate,
  useReducedMotion,
} from 'framer-motion';
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
    const id = setInterval(load, 60_000);
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

/* ── Fill plaque: one quiet surface — live majors rotate through it ── */
const PLAQUE_PAIRS = ['BTC', 'ETH', 'XLM', 'SOL'] as const;

function TerminalCard() {
  const prefersReducedMotion = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const [ticks, setTicks] = useState<
    Record<string, { price: number; change: number | null }>
  >({});

  // One quiet fetch per minute — the landing doesn't need trading cadence.
  useEffect(() => {
    let alive = true;
    const load = () => {
      PLAQUE_PAIRS.forEach(async (sym) => {
        try {
          const t = await fetchTicker(sym);
          if (alive)
            setTicks((prev) => ({
              ...prev,
              [sym]: { price: t.price, change: t.changePercent24h },
            }));
        } catch {
          /* keep the previous tick */
        }
      });
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % PLAQUE_PAIRS.length), 3200);
    return () => clearInterval(id);
  }, [prefersReducedMotion]);

  const sym = PLAQUE_PAIRS[idx];
  const tick = ticks[sym];
  const change = tick?.change ?? null;

  return (
    <div className="w-[340px] rounded-xl border border-white/[0.08] bg-[#0B0D10]/60 backdrop-blur-xl px-7 py-6">
      {/* Pair identity — real token mark, live pulse */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={sym}
          initial={prefersReducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReducedMotion ? undefined : { opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <p className="flex items-center gap-2.5">
            <TokenIcon symbol={sym} size={22} />
            <span className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground/90">
              {sym}-PERP
            </span>
            <span className="relative flex h-1 w-1" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full rounded-full bg-long opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-1 w-1 rounded-full bg-long" />
            </span>
          </p>

          {/* The mark — large, thin, unhurried; real Binance reference */}
          <p className="mt-3 font-mono text-[32px] font-light leading-none tracking-tight text-foreground tabular-nums">
            {tick ? formatUSD(tick.price, priceDecimals(sym)) : '—'}
          </p>

          {/* 24h change + source, one whisper of a line */}
          <p className="mt-4 flex items-baseline gap-3 font-mono text-[11.5px]">
            <span
              className={
                change == null
                  ? 'text-muted-foreground'
                  : change >= 0
                    ? 'text-long'
                    : 'text-short'
              }
            >
              {change == null ? '— 24h' : `${formatPercent(change)} 24h`}
            </span>
            <span className="text-faint">Noeracle mark · ~500ms</span>
          </p>
        </motion.div>
      </AnimatePresence>

      {/* Pair trace: one grain of light per market */}
      <div className="mt-5 flex items-center gap-1.5" aria-hidden="true">
        {PLAQUE_PAIRS.map((p, i) => (
          <span
            key={p}
            className={
              i === idx
                ? 'h-[3px] w-[3px] rounded-full bg-primary transition-colors duration-300'
                : 'h-[3px] w-[3px] rounded-full bg-white/15 transition-colors duration-300'
            }
          />
        ))}
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
              poster="/media/hero-poster.jpg"
              preload="metadata"
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
                  {/* CSS entrance (not FadeIn): the LCP headline and the only
                      mobile CTAs must be visible in SSR HTML — framer-motion's
                      initial="hidden" serialized opacity:0 inline and held the
                      biggest text on the page hostage to JS hydration. */}
                  <div className="hero-enter" style={{ animationDelay: '0.05s' }}>
                    <h1 className="font-display font-normal tracking-[-0.015em] leading-[1.02] text-foreground text-[clamp(3.25rem,7.5vw,7rem)]">
                      The world based
                      <br />
                      on <em className="italic text-primary">leverage.</em>
                    </h1>
                  </div>
                  <div className="hero-enter" style={{ animationDelay: '0.2s' }}>
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
                  </div>
                </div>

                {/* Terminal card shares the composition's baseline */}
                <div className="hidden lg:block shrink-0 pb-1 hero-enter" style={{ animationDelay: '0.35s' }}>
                  <TerminalCard />
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
        <div className="flex flex-wrap items-center justify-center gap-x-16 gap-y-8 opacity-80">
          {/* Official press-kit marks — black variants on the bone strip */}
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand logo */}
          <img
            src="/media/brand/stellar-black.png"
            alt="Stellar"
            width="128"
            height="32"
            className="h-7 w-auto"
          />
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand logo */}
          <img
            src="/media/brand/sdf-black.svg"
            alt="Stellar Development Foundation"
            width="180"
            height="32"
            className="h-8 w-auto"
          />
        </div>
      </section>

      {/* ── Color-block band: onboarding · live markets · gold CTA ── */}
      <section className="border-t border-border">
        <div className="grid lg:grid-cols-3 items-stretch">
          {/* Start in three moves — gold, mirroring the CTA slab */}
          <div className="bg-[#DCA82B] text-[#0B0D10] px-8 py-12">
            <h2 className="text-lg font-semibold tracking-[-0.01em] mb-5">
              Start in three moves
            </h2>
            <div>
              {[
                { n: '01', label: 'Connect your Stellar wallet', href: '/trade' },
                IS_MAINNET_BUILD
                  ? { n: '02', label: 'Fund your wallet with USDC', href: '/trade' }
                  : { n: '02', label: 'Claim testnet USDC from the faucet', href: '/faucet' },
                { n: '03', label: 'Open your first position', href: '/trade' },
              ].map((step) => (
                <Link
                  key={step.n}
                  href={step.href}
                  className="flex items-baseline gap-4 py-3.5 border-b border-black/15 last:border-b-0 group"
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
