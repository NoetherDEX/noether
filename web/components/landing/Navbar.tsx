'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { NoetherLogo } from './NoetherLogo';
import { cn } from '@/lib/utils/cn';

const NAV_LINKS = [
  { href: '/trade', label: 'Trade' },
  { href: '/vaults', label: 'Vaults' },
  { href: '/referrals', label: 'Referrals' },
  { href: '/leaderboard', label: 'Leaderboard' },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <nav
        className={cn(
          'fixed top-0 left-0 right-0 z-50 h-16 px-5 sm:px-8 flex items-center transition-colors duration-500',
          scrolled
            ? 'bg-[#E8E6E1]/95 backdrop-blur-md border-b border-black/10'
            : 'bg-transparent border-b border-transparent'
        )}
      >
        {/* Logo */}
        <Link href="/" className="flex-shrink-0">
          <NoetherLogo className="h-6 w-auto" maskColor={scrolled ? '#f8f6f0' : '#0B0D10'} />
        </Link>

        {/* Desktop links — dead-center, unclamped from the logo */}
        <div className="hidden lg:flex items-center gap-8 absolute left-1/2 -translate-x-1/2">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'text-sm font-medium transition-colors',
                scrolled
                  ? 'text-black/60 hover:text-black'
                  : 'text-foreground/65 hover:text-foreground'
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Launch App CTA — gold pill, the one accent in the chrome.
              Visible at EVERY width: below lg this is the page's only
              primary CTA until the hero hydrates. */}
          <Link
            href="/trade"
            className="inline-flex items-center h-9 lg:h-10 px-4 lg:px-6 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Launch App
          </Link>

          {/* Mobile hamburger */}
          <button
            className="lg:hidden flex flex-col justify-center items-center gap-[5px] w-11 h-11 -mr-2"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            <span className={cn('block w-[18px] h-px transition-transform duration-200', scrolled ? 'bg-black' : 'bg-foreground', mobileOpen && 'rotate-45 translate-y-[6px]')} />
            <span className={cn('block w-[18px] h-px transition-opacity duration-200', scrolled ? 'bg-black' : 'bg-foreground', mobileOpen && 'opacity-0')} />
            <span className={cn('block w-[18px] h-px transition-transform duration-200', scrolled ? 'bg-black' : 'bg-foreground', mobileOpen && '-rotate-45 -translate-y-[6px]')} />
          </button>
        </div>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="lg:hidden fixed top-16 left-0 right-0 z-50 bg-surface border-b border-border p-3">
          <div className="flex flex-col gap-0.5">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-3 py-3 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/trade"
              className="mt-2 inline-flex items-center justify-center h-11 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              onClick={() => setMobileOpen(false)}
            >
              Launch App
            </Link>
          </div>
        </div>
      )}

      {/* Skip-link target: after the nav, before the page content */}
      <span id="main-content" tabIndex={-1} className="sr-only" />
    </>
  );
}
