'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ConnectButton } from '@/components/wallet';
import { NoetherLogo } from '@/components/landing/NoetherLogo';
import { cn } from '@/lib/utils/cn';

const navItems = [
  { href: '/trade', label: 'Trade' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/vault', label: 'Vault' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/faucet', label: 'Faucet' },
];

export function Header() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

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
      <header
        className={cn(
          'fixed top-0 left-0 right-0 z-50 px-4 sm:px-6 lg:px-8 py-3 sm:py-4 flex items-center justify-between transition-all duration-300',
          scrolled
            ? 'bg-[#050508]/85 backdrop-blur-[20px] border-b border-white/[0.06]'
            : 'bg-[#050508]/60 backdrop-blur-[12px]'
        )}
      >
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 flex-shrink-0">
          <NoetherLogo className="h-7 sm:h-8 w-auto" />
        </Link>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 lg:gap-10">
          {navItems.map((item) => {
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative text-sm font-medium transition-colors',
                  isActive
                    ? 'text-white'
                    : 'text-white/60 hover:text-white'
                )}
              >
                {item.label}
                {isActive && (
                  <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-[#eab308] rounded-full" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Right side: Connect + Hamburger */}
        <div className="flex items-center gap-2 sm:gap-3">
          <ConnectButton />

          {/* Mobile hamburger */}
          <button
            className="md:hidden flex flex-col gap-1.5 p-2 -mr-2"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            <span className={cn('block w-5 h-0.5 bg-white transition-all duration-200', mobileOpen && 'rotate-45 translate-y-2')} />
            <span className={cn('block w-5 h-0.5 bg-white transition-all duration-200', mobileOpen && 'opacity-0')} />
            <span className={cn('block w-5 h-0.5 bg-white transition-all duration-200', mobileOpen && '-rotate-45 -translate-y-2')} />
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
          <div className="absolute top-[56px] left-0 right-0 bg-[#0a0a0c] border-b border-white/10 p-4 space-y-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'block px-4 py-3 rounded-lg text-base font-medium transition-colors',
                    isActive
                      ? 'text-white bg-white/5'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  )}
                >
                  {item.label}
                  {isActive && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#eab308] ml-2" />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
