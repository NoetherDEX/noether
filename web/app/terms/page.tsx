import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Use',
  robots: { index: false },
}

/**
 * Beta Terms of Use — the document the waitlist attestation links. Drafted
 * from a standard DEX-beta template; gets a proper review before the public
 * (LAUNCH_GATE=0) launch. Version bumps must also bump TOS_VERSION in the
 * gateway (api/src/services/accessGrants.ts) so grants record what was
 * accepted.
 */
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-white/80">
      <h1 className="text-3xl font-semibold text-white" style={{ fontFamily: 'var(--font-sora)' }}>
        Terms of Use — Noether v1 Beta
      </h1>
      <p className="mt-2 text-sm text-white/40">Version v1-2026-08</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="text-base font-semibold text-white">1. What this is</h2>
          <p className="mt-2">
            Noether is a decentralized perpetual futures exchange built on the Stellar network.
            Access during the beta is limited to approved wallets. The interface at
            noether.exchange is one way to interact with permissionless smart contracts; the
            contracts themselves operate autonomously on-chain.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-white">2. Eligibility</h2>
          <p className="mt-2">
            By joining the waitlist or using the interface you represent that you are not a
            resident or citizen of, or accessing the interface from, the United States, the
            Province of Ontario (Canada), or any jurisdiction subject to comprehensive sanctions
            (including Cuba, Iran, North Korea, Syria, Russia, and Belarus); that you are not on
            any sanctions list; and that you are not using a VPN or similar tool to disguise your
            location.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-white">3. Risk</h2>
          <p className="mt-2">
            Leveraged derivatives trading involves substantial risk of loss. Positions can be
            liquidated. Smart contracts, oracles, and interfaces may contain defects despite
            audits and reviews. During the beta, protocol parameters (leverage, position and
            deposit caps) are deliberately conservative and may change. You may lose all funds
            you deposit or trade with. Use only funds you can afford to lose entirely.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-white">4. No advice, no custody</h2>
          <p className="mt-2">
            Nothing on this interface is investment, legal, or tax advice. Noether does not take
            custody of your assets: all funds are held by on-chain contracts controlled by your
            keys and the protocol&apos;s published rules.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-white">5. Beta access & data</h2>
          <p className="mt-2">
            Beta access is granted per wallet and may be revoked at any time. If you share an
            email address on the waitlist we use it solely to notify you about your access status
            and important protocol notices; ask us to delete it at any time. We keep an audit
            trail of access decisions.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-white">6. Disclaimer & limitation</h2>
          <p className="mt-2">
            The interface and protocol are provided &quot;as is&quot; without warranties of any
            kind. To the maximum extent permitted by law, Noether and its contributors are not
            liable for any losses arising from your use of the interface or the underlying
            contracts.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-white">7. Contact</h2>
          <p className="mt-2">
            Questions: reach us on{' '}
            <a href="https://x.com/Noetherdex" className="text-[#eab308] hover:underline">
              X / Twitter
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  )
}
