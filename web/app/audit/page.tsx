import type { Metadata } from 'next'
import { TeaserLogo } from '@/components/landing/TeaserLogo'
import { WaitlistCard } from '@/components/landing/WaitlistCard'

export const metadata: Metadata = {
  title: 'Mainnet waitlist',
  description:
    'Mainnet perks are reserved for the waitlist. Access opens in waves — trade on the public testnet while you wait.',
  robots: { index: false },
}

const FAQ = [
  {
    q: 'What is Noether?',
    a: 'A decentralized perpetual futures exchange on Stellar. Every order, match, and settlement happens on-chain through Soroban smart contracts — the interface is just a window onto them.',
  },
  {
    q: 'When does mainnet open?',
    a: 'After the independent third-party audit of the contracts completes. Access then opens in waves from this waitlist, with deliberately conservative caps that widen as the protocol soaks.',
  },
  {
    q: 'How does the waitlist work?',
    a: 'Join with your Stellar wallet — the email is optional and only used to tell you when you are in. Approved wallets unlock noether.exchange with a signature. Eligibility rules are in the Terms.',
  },
  {
    q: 'Is it non-custodial?',
    a: 'Yes. Your funds sit in on-chain contracts controlled by your keys and the published protocol rules. Noether never holds your assets, and every action requires your wallet signature.',
  },
  {
    q: 'Which wallets can I use?',
    a: 'Freighter and LOBSTR (via WalletConnect) work today, and most Stellar wallets that can sign Soroban transactions will too.',
  },
  {
    q: 'Can I try it before mainnet?',
    a: 'Right now: the full exchange runs on the public Stellar testnet with free test funds from the built-in faucet. Same contracts, same interface, zero risk.',
  },
]

/**
 * Pre-launch teaser. The launch-gate middleware rewrites every route here
 * while LAUNCH_GATE=1 and no access cookie is present — this page itself is
 * static and must stay dependency-light (no wallet/stellar imports).
 */
export default function AuditPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
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
      <TeaserLogo />
      <h1
        className="mt-8 max-w-xl text-4xl font-semibold tracking-tight [text-wrap:balance] sm:text-5xl"
        style={{ fontFamily: 'var(--font-sora)' }}
      >
        Mainnet perks are reserved for the waitlist
        <span className="text-[#eab308]">.</span>
      </h1>
      <p className="mt-4 max-w-md text-base leading-relaxed text-white/60">
        Access opens in waves — early wallets get in first. Until then, prove
        your edge on{' '}
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

      {/* FAQ — native <details>, zero client JS, teaser stays static. */}
      <section className="mt-14 w-full max-w-md text-left">
        <h2
          className="text-center text-lg font-semibold text-white/90"
          style={{ fontFamily: 'var(--font-sora)' }}
        >
          Questions, answered
        </h2>
        <div className="mt-4 space-y-2">
          {FAQ.map((f) => (
            <details
              key={f.q}
              className="group rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
            >
              <summary className="cursor-pointer list-none text-sm font-medium text-white/80 transition group-open:text-white">
                {f.q}
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-white/50">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <div className="mt-12 flex items-center gap-6 text-sm text-white/40">
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
