import type { Metadata } from 'next'
import { TeaserLogo } from '@/components/landing/TeaserLogo'
import { WaitlistCard } from '@/components/landing/WaitlistCard'

export const metadata: Metadata = {
  title: 'Audit in progress',
  description:
    "Noether's mainnet contracts are being audited. Trade on the public testnet while you wait.",
  robots: { index: false },
}

/**
 * Pre-launch teaser. The launch-gate middleware rewrites every route here
 * while LAUNCH_GATE=1 and no access cookie is present — this page itself is
 * static and must stay dependency-light (no wallet/stellar imports).
 */
export default function AuditPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <TeaserLogo />
      <h1
        className="mt-8 text-4xl font-semibold tracking-tight sm:text-5xl"
        style={{ fontFamily: 'var(--font-sora)' }}
      >
        Audit in progress<span className="text-[#eab308]">.</span>
      </h1>
      <p className="mt-4 max-w-md text-base leading-relaxed text-white/60">
        Noether&apos;s mainnet contracts are being audited. Mainnet opens when
        the audit clears — until then, trade with test funds on our public
        testnet.
      </p>
      <a
        href="https://testnet.noether.exchange/trade"
        className="mt-8 inline-flex items-center gap-2 rounded-xl bg-[#eab308] px-6 py-3 text-sm font-semibold text-black transition hover:bg-[#facc15]"
      >
        Trade on testnet
        <span aria-hidden>→</span>
      </a>
      {/* Client island — everything wallet/stellar-heavy inside is lazy,
          so the teaser's first load stays dependency-light. */}
      <WaitlistCard />
      <div className="mt-10 flex items-center gap-6 text-sm text-white/40">
        <a
          href="https://docs.noether.exchange"
          className="transition hover:text-white/80"
        >
          Docs
        </a>
        <a
          href="https://x.com/Noetherdex"
          className="transition hover:text-white/80"
        >
          X / Twitter
        </a>
      </div>
    </main>
  )
}
