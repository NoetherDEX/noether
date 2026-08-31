import type { Metadata } from 'next'
import { TeaserLogo } from '@/components/landing/TeaserLogo'
import { WaitlistCard } from '@/components/landing/WaitlistCard'

export const metadata: Metadata = {
  title: 'Mainnet waitlist',
  description:
    'Mainnet perks are reserved for the waitlist. Access opens in waves. Trade on the public testnet while you wait.',
  robots: { index: false },
}

/**
 * Pre-launch teaser. The launch-gate middleware rewrites every route here
 * while LAUNCH_GATE=1 and no access cookie is present — this page itself is
 * static and must stay dependency-light (no wallet/stellar imports).
 */
export default function AuditPage() {
  return (
    <main className="flex min-h-screen flex-col items-center px-6 text-center">
      {/* Full-viewport backdrop. A position:fixed layer, not
          background-attachment:fixed (broken on iOS), and pure CSS so the
          teaser keeps its zero client JS. Cover-cropping keeps the helmets
          in the corners at any aspect ratio; on narrow screens they crop
          away and the plain dark field remains. */}
      <div
        aria-hidden
        className="fixed inset-0 -z-10 bg-cover bg-center"
        style={{ backgroundImage: "url('/waitlist-bg.jpg')" }}
      />
      {/* Everything above the footer centers in the remaining viewport
          height, so the teaser reads as a single non-scrolling screen. */}
      <div className="flex w-full flex-1 flex-col items-center justify-center">
        <TeaserLogo />
        <h1
          className="mt-8 max-w-xl text-4xl font-semibold tracking-tight [text-wrap:balance] sm:text-5xl"
          style={{ fontFamily: 'var(--font-sora)' }}
        >
          Mainnet perks are reserved for the waitlist
          <span className="text-[#eab308]">.</span>
        </h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-white/60">
          Access opens in waves and early wallets get in first. Until then,
          prove your edge on{' '}
          <a
            href="https://testnet.noether.exchange/trade"
            className="font-medium text-[#eab308] underline-offset-4 transition hover:underline"
          >
            testnet.noether.exchange
          </a>{' '}
          with free test funds.
        </p>
        {/* Client island — everything wallet/stellar-heavy inside is lazy,
            so the teaser's first load stays dependency-light. */}
        <WaitlistCard />
      </div>

      {/* The teaser owns its footer (AppFooter hides on /audit) so the
          whole page fits one viewport with nothing rendered below it. */}
      <footer className="w-full pb-5 pt-6">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-white/40">
          <a href="/terms" className="transition hover:text-white/80">
            Terms
          </a>
          <span aria-hidden className="text-white/20">·</span>
          <a href="/privacy" className="transition hover:text-white/80">
            Privacy
          </a>
          <span aria-hidden className="text-white/20">·</span>
          <a
            href="https://docs.noether.exchange"
            target="_blank"
            rel="noopener noreferrer"
            className="transition hover:text-white/80"
          >
            Docs
          </a>
          <span aria-hidden className="text-white/20">·</span>
          <a
            href="https://discord.gg/hmS6t2R5z"
            target="_blank"
            rel="noopener noreferrer"
            className="transition hover:text-white/80"
          >
            Discord
          </a>
          <span aria-hidden className="text-white/20">·</span>
          <a
            href="https://x.com/Noetherdex"
            target="_blank"
            rel="noopener noreferrer"
            className="transition hover:text-white/80"
          >
            X / Twitter
          </a>
          <span aria-hidden className="text-white/20">·</span>
          <span>© 2026 Noether · Testnet</span>
        </div>
      </footer>
    </main>
  )
}
