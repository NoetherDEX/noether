'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { DISCORD_URL } from '@/lib/utils/constants';
import { DOCS_URL } from './nav';

/**
 * One-line legal footer for app pages (Terms · Docs · Discord · ©).
 * The landing page renders its own LandingFooter, so this hides on '/'.
 */
export function AppFooter() {
  const pathname = usePathname();
  if (pathname === '/') return null;

  const isTrade = pathname === '/trade';

  return (
    <footer
      data-noether-chrome
      className={cn(
        'relative z-10 border-t border-white/[0.06] px-4 sm:px-6 py-4',
        // Clear the fixed MobileTradeBar on /trade below lg
        isTrade && 'pb-24 lg:pb-4'
      )}
    >
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-white/60">
        <Link href="/terms" className="hover:text-white/90 transition-colors">
          Terms
        </Link>
        <span aria-hidden="true" className="text-white/25">·</span>
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-white/90 transition-colors"
        >
          Docs
        </a>
        <span aria-hidden="true" className="text-white/25">·</span>
        <a
          href={DISCORD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-white/90 transition-colors"
        >
          Discord
        </a>
        <span aria-hidden="true" className="text-white/25">·</span>
        <span>© 2026 Noether · Testnet</span>
      </div>
    </footer>
  );
}
