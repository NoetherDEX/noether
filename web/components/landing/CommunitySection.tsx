'use client';

import Link from 'next/link';
import { FadeIn } from './animations';

/* Organic topographic contour lines — SVG paths */
function ContourLines() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 1440 900"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
      >
        {/* Layer 1 — large sweeping lines */}
        <path
          d="M-100 350 C200 280, 400 420, 600 350 S900 200, 1100 320 S1400 380, 1600 300"
          stroke="rgba(234, 179, 8, 0.08)"
          strokeWidth="1.5"
          fill="none"
        />
        <path
          d="M-100 380 C200 310, 400 450, 600 380 S900 230, 1100 350 S1400 410, 1600 330"
          stroke="rgba(234, 179, 8, 0.06)"
          strokeWidth="1.5"
          fill="none"
        />
        <path
          d="M-100 410 C200 340, 400 480, 600 410 S900 260, 1100 380 S1400 440, 1600 360"
          stroke="rgba(34, 197, 94, 0.06)"
          strokeWidth="1.5"
          fill="none"
        />
        <path
          d="M-100 440 C200 370, 400 510, 600 440 S900 290, 1100 410 S1400 470, 1600 390"
          stroke="rgba(34, 197, 94, 0.05)"
          strokeWidth="1.5"
          fill="none"
        />
        <path
          d="M-100 470 C200 400, 400 540, 600 470 S900 320, 1100 440 S1400 500, 1600 420"
          stroke="rgba(234, 179, 8, 0.04)"
          strokeWidth="1.5"
          fill="none"
        />

        {/* Layer 2 — mid contours */}
        <path
          d="M-50 500 C180 430, 380 560, 580 490 S880 350, 1080 470 S1380 530, 1550 450"
          stroke="rgba(234, 179, 8, 0.07)"
          strokeWidth="1"
          fill="none"
        />
        <path
          d="M-50 530 C180 460, 380 590, 580 520 S880 380, 1080 500 S1380 560, 1550 480"
          stroke="rgba(34, 197, 94, 0.05)"
          strokeWidth="1"
          fill="none"
        />
        <path
          d="M-50 560 C180 490, 380 620, 580 550 S880 410, 1080 530 S1380 590, 1550 510"
          stroke="rgba(234, 179, 8, 0.04)"
          strokeWidth="1"
          fill="none"
        />

        {/* Layer 3 — upper region contours */}
        <path
          d="M-80 200 C250 150, 450 280, 650 220 S950 130, 1150 230 S1400 270, 1600 210"
          stroke="rgba(34, 197, 94, 0.06)"
          strokeWidth="1"
          fill="none"
        />
        <path
          d="M-80 230 C250 180, 450 310, 650 250 S950 160, 1150 260 S1400 300, 1600 240"
          stroke="rgba(234, 179, 8, 0.05)"
          strokeWidth="1"
          fill="none"
        />
        <path
          d="M-80 260 C250 210, 450 340, 650 280 S950 190, 1150 290 S1400 330, 1600 270"
          stroke="rgba(34, 197, 94, 0.04)"
          strokeWidth="1"
          fill="none"
        />

        {/* Layer 4 — lower region contours */}
        <path
          d="M-60 620 C220 570, 420 680, 620 610 S920 500, 1120 620 S1400 660, 1580 590"
          stroke="rgba(234, 179, 8, 0.05)"
          strokeWidth="1"
          fill="none"
        />
        <path
          d="M-60 650 C220 600, 420 710, 620 640 S920 530, 1120 650 S1400 690, 1580 620"
          stroke="rgba(34, 197, 94, 0.04)"
          strokeWidth="1"
          fill="none"
        />
        <path
          d="M-60 680 C220 630, 420 740, 620 670 S920 560, 1120 680 S1400 720, 1580 650"
          stroke="rgba(234, 179, 8, 0.03)"
          strokeWidth="1"
          fill="none"
        />

        {/* Layer 5 — tight cluster detail lines */}
        <path
          d="M300 300 C400 270, 500 350, 600 310 S750 260, 850 320"
          stroke="rgba(234, 179, 8, 0.09)"
          strokeWidth="0.8"
          fill="none"
        />
        <path
          d="M300 320 C400 290, 500 370, 600 330 S750 280, 850 340"
          stroke="rgba(34, 197, 94, 0.07)"
          strokeWidth="0.8"
          fill="none"
        />
        <path
          d="M700 500 C800 470, 900 540, 1000 500 S1150 450, 1250 510"
          stroke="rgba(234, 179, 8, 0.07)"
          strokeWidth="0.8"
          fill="none"
        />
        <path
          d="M700 520 C800 490, 900 560, 1000 520 S1150 470, 1250 530"
          stroke="rgba(34, 197, 94, 0.06)"
          strokeWidth="0.8"
          fill="none"
        />
      </svg>
    </div>
  );
}

export function CommunitySection() {
  return (
    <section className="snap-section section-light flex flex-col items-center justify-center px-6 relative">
      {/* Contour line background */}
      <ContourLines />

      {/* Content */}
      <div className="relative z-10 text-center max-w-[800px] mx-auto">
        {/* Subtitle */}
        <FadeIn delay={0.1}>
          <p className="text-sm md:text-base text-[#1a1a1a]/50 mb-6 leading-relaxed">
            No centralized exchanges. No counterparty risk. No compromises.
          </p>
        </FadeIn>

        {/* Giant heading */}
        <FadeIn delay={0.2}>
          <h2 className="text-5xl md:text-7xl lg:text-[5.5rem] font-heading font-bold tracking-[-0.02em] leading-[0.95] text-[#1a1a1a] mb-10">
            Community first.
          </h2>
        </FadeIn>

        {/* Description with highlighted words */}
        <FadeIn delay={0.4}>
          <p className="text-base md:text-lg text-[#1a1a1a]/55 leading-relaxed max-w-[650px] mx-auto mb-6">
            Anyone can{' '}
            <span className="text-[#1a1a1a] font-medium">trade</span>,{' '}
            <span className="text-[#1a1a1a] font-medium">provide liquidity</span>, and{' '}
            <span className="text-[#1a1a1a] font-medium">shape the future</span> of Noether.
            Built on{' '}
            <span className="text-[#eab308] font-medium">Stellar</span>, powered by{' '}
            <span className="text-[#22c55e] font-medium">Soroban</span> smart contracts.
          </p>
        </FadeIn>

        <FadeIn delay={0.5}>
          <p className="text-xl md:text-2xl font-semibold text-[#1a1a1a] mb-10">
            Own a piece of decentralized trading today.
          </p>
        </FadeIn>

        {/* CTAs */}
        <FadeIn delay={0.6}>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link href="/trade" className="pill-button pill-button-filled">
              Start Trading
            </Link>
            <Link href="/vault" className="pill-button pill-button-outline">
              Provide Liquidity
            </Link>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
