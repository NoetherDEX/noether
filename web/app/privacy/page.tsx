import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'What Noether collects (a wallet address, an optional email), who processes it, and how to have it deleted.',
}

/**
 * Privacy Policy — companion to /terms. Indexable on purpose (it is a trust
 * page). Content changes that alter what users consent to on the waitlist
 * must bump TOS_VERSION in the gateway (api/src/services/accessGrants.ts).
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-white/80">
      <h1 className="text-3xl font-semibold text-white" style={{ fontFamily: 'var(--font-sora)' }}>
        Privacy Policy — Noether
      </h1>
      <p className="mt-2 text-sm text-white/40">Version v1-2026-08</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="text-base font-semibold text-white">1. What we collect</h2>
          <p className="mt-2">
            Very little. If you join the waitlist we store your Stellar wallet address, the
            optional email you choose to share, the trader segment you pick, and the time you
            accepted the Terms. If you are granted access we keep an audit trail of that decision.
            If you create an API key we store the key&apos;s hashed secret and the wallet that owns
            it — never a password, because Noether has none. Our servers keep short-lived
            operational logs (request metadata and IP addresses) for security and debugging.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-white">2. What lives on-chain</h2>
          <p className="mt-2">
            Your trading activity — positions, orders, deposits, liquidations — is public data on
            the Stellar network, tied to your wallet address. It is pseudonymous by design, and it
            is not something we hold or can delete: the blockchain is the record, not our
            database. Our indexer only mirrors what the chain already shows publicly.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-white">3. Cookies & analytics</h2>
          <p className="mt-2">
            The interface sets one functional cookie: a signed access token after your wallet is
            approved during the beta. It identifies your approval, not your browsing. We use
            self-hosted, cookieless analytics to count page views and see which pages matter —
            the data stays on our own infrastructure, is not shared with any advertising or
            analytics company, and does not follow you across the web. No ad trackers, ever.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-white">4. Who processes data for us</h2>
          <p className="mt-2">
            Cloudflare sits in front of our domains and provides the Turnstile bot check on the
            waitlist form. Microsoft Azure hosts our servers and database and delivers our emails
            (sent from noreply@noether.exchange via Azure Communication Services). Both act as
            infrastructure providers under their own compliance programs; neither receives your
            data for their own use. We do not sell or rent any data to anyone.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-white">5. Retention & deletion</h2>
          <p className="mt-2">
            Your email exists for exactly one purpose: telling you about your access status and
            important protocol notices. Ask us to delete it at any time and we will erase it from
            our records while keeping your wallet&apos;s access status intact. The wallet-level
            audit trail of access decisions is retained for the integrity of the beta program.
            Operational logs expire on a rolling basis.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-white">6. Contact</h2>
          <p className="mt-2">
            Deletion requests and privacy questions: reach us on{' '}
            <a href="https://x.com/Noetherdex" className="text-[#eab308] hover:underline">
              X / Twitter
            </a>{' '}
            from the account you want us to act on, or open an issue on{' '}
            <a href="https://github.com/NoetherDEX" className="text-[#eab308] hover:underline">
              GitHub
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  )
}
