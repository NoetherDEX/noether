import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Access Restricted', // root layout template appends '| Noether Testnet'
  robots: { index: false, follow: false },
};

export default function RestrictedPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-lg text-center space-y-5">
        <h1 className="text-2xl font-semibold text-white">Trading not available in your region</h1>
        <p className="text-sm leading-relaxed text-white/60">
          Based on your location, access to Noether&apos;s trading and vault
          interfaces is restricted. Leveraged derivatives are not offered to
          persons in the United States, Ontario (Canada), or
          sanctioned jurisdictions.
        </p>
        <p className="text-sm leading-relaxed text-white/60">
          Using a VPN or other means to circumvent this restriction is
          prohibited under our{' '}
          <Link href="/terms" className="text-white underline underline-offset-4">
            Terms of Service
          </Link>
          .
        </p>
        <div className="pt-2">
          <Link
            href="/"
            className="inline-flex items-center rounded-lg border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/5"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
