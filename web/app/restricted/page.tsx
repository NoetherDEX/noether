import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Access Restricted', // root layout template appends '| Noether Testnet'
  robots: { index: false, follow: false },
};

export default function RestrictedPage() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-lg text-center space-y-5">
        <h1 className="text-xl font-medium text-foreground">Trading not available in your region</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Based on your location, access to Noether&apos;s trading and vault
          interfaces is restricted. Leveraged derivatives are not offered to
          persons in the United States, Ontario (Canada), or
          sanctioned jurisdictions.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Using a VPN or other means to circumvent this restriction is
          prohibited under our{' '}
          <Link href="/terms" className="text-foreground underline underline-offset-4">
            Terms of Service
          </Link>
          .
        </p>
        <div className="pt-2">
          <Link
            href="/"
            className="inline-flex items-center rounded-md border border-border-strong px-4 py-2 text-sm text-foreground hover:bg-surface-3 transition-colors"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
