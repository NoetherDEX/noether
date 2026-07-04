import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service | Noether',
};

const UPDATED = 'July 4, 2026';

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold text-white">Terms of Service</h1>
      <p className="mt-2 text-sm text-white/40">Last updated: {UPDATED}</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-white/70">
        <p>
          These Terms govern your access to and use of the Noether interface at
          noether.exchange (the &ldquo;Interface&rdquo;), a front-end to
          non-custodial smart contracts deployed on the Stellar network. By
          accessing the Interface you agree to these Terms. The Interface is
          provided on an &ldquo;as is&rdquo; basis; the underlying protocol is
          autonomous software and Noether does not take custody of your assets.
        </p>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-white">1. Eligibility &amp; restricted persons</h2>
          <p>
            You represent and warrant that you are not, and are not acting on
            behalf of: (a) a person located in, resident of, or organized under
            the laws of the United States or the Province of Ontario, Canada;
            (b) a person located in or a national of any jurisdiction subject to
            comprehensive sanctions (including Cuba, Iran, North Korea, Syria,
            Russia, and Belarus); or (c) a person listed on any sanctions list
            (collectively, &ldquo;Restricted Persons&rdquo;). Access to the
            trading and vault interfaces is blocked by jurisdiction; if you are a
            Restricted Person you must not use the Interface.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-white">2. No circumvention</h2>
          <p>
            You must not use a VPN, proxy, or any other technique to disguise
            your location or otherwise circumvent the geographic restrictions or
            eligibility requirements of these Terms. Doing so is a material
            breach.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-white">3. Risk disclosure</h2>
          <p>
            Perpetual futures are leveraged instruments and carry substantial
            risk of loss, including liquidation of your entire position. Prices
            are sourced from an on-chain oracle and may be volatile or, in
            adverse conditions, stale. You are solely responsible for your
            trading decisions, key custody, and tax obligations. Never trade with
            funds you cannot afford to lose.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-white">4. Non-custodial &amp; no advice</h2>
          <p>
            All transactions are executed by smart contracts you interact with
            directly through your own wallet. Noether cannot access, freeze, or
            reverse your funds. Nothing in the Interface constitutes financial,
            legal, or tax advice.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-white">5. Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, Noether and its contributors
            will not be liable for any indirect, incidental, or consequential
            damages, or for any loss of funds arising from your use of the
            Interface or the underlying protocol, smart-contract bugs, oracle
            failures, or network conditions.
          </p>
        </section>

        <p className="text-white/40">
          Questions? Reach us via{' '}
          <a href="https://twitter.com/Noetherdex" className="underline underline-offset-4">
            @Noetherdex
          </a>
          . Security disclosures: see our{' '}
          <a
            href="https://github.com/NoetherDEX/noether/blob/main/SECURITY.md"
            className="underline underline-offset-4"
          >
            security policy
          </a>
          .
        </p>

        <div className="pt-4">
          <Link href="/" className="text-white underline underline-offset-4">
            ← Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
