'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ConnectButton } from '@/components/wallet';
import { NoetherLogo } from '@/components/landing/NoetherLogo';
import { cn } from '@/lib/utils/cn';
import { APP_NAV_ITEMS } from './nav';

const navItems = APP_NAV_ITEMS;

export function Header() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [mobileOpen]);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 h-12 px-4 sm:px-5 flex items-center gap-6 bg-background/90 backdrop-blur-md border-b border-border">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 flex-shrink-0">
          <NoetherLogo className="h-6 w-auto" />
          <span className="px-1.5 py-0.5 rounded-sm border border-primary/30 text-primary text-[10px] font-medium uppercase tracking-widest leading-none">
            Testnet
          </span>
        </Link>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-1 h-full">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative flex items-center h-full px-3 text-[13px] font-medium transition-colors',
                  isActive
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {item.label}
                {isActive && (
                  <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-primary" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Right side: Connect + Hamburger */}
        <div className="ml-auto flex items-center gap-2">
          <ConnectButton />

          {/* Mobile hamburger */}
          <button
            className="md:hidden flex flex-col justify-center gap-[5px] w-11 h-11 items-center -mr-2"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            <span className={cn('block w-[18px] h-px bg-foreground transition-transform duration-200', mobileOpen && 'rotate-45 translate-y-[6px]')} />
            <span className={cn('block w-[18px] h-px bg-foreground transition-opacity duration-200', mobileOpen && 'opacity-0')} />
            <span className={cn('block w-[18px] h-px bg-foreground transition-transform duration-200', mobileOpen && '-rotate-45 -translate-y-[6px]')} />
          </button>
        </div>
      </header>

      {/* Mobile menu overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />

          {/* Menu panel */}
          <div className="absolute top-12 left-0 right-0 bg-surface border-b border-border p-3 space-y-0.5">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'block px-3 py-3 rounded-md text-sm font-medium transition-colors',
                    isActive
                      ? 'text-foreground bg-surface-2'
                      : 'text-muted-foreground hover:text-foreground hover:bg-surface-2'
                  )}
                >
                  {item.label}
                  {isActive && (
                    <span className="inline-block w-1 h-1 rounded-full bg-primary ml-2 align-middle" />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Skip-link target: sits after all header chrome, so the next Tab lands in page content */}
      <span id="main-content" tabIndex={-1} className="sr-only" />
    </>
  );
}
