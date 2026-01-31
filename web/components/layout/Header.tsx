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

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header
      className={cn(
        'fixed top-0 left-0 right-0 z-50 px-8 py-4 flex items-center justify-between transition-all duration-300',
        scrolled
          ? 'bg-[#050508]/85 backdrop-blur-[20px] border-b border-white/[0.06]'
          : 'bg-[#050508]/60 backdrop-blur-[12px]'
      )}
    >
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2">
        <NoetherLogo className="h-8 w-auto" />
      </Link>

      {/* Navigation Links */}
      <nav className="flex items-center gap-10">
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
                <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-gradient-to-r from-[#eab308] to-[#22c55e] rounded-full" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Connect Wallet */}
      <ConnectButton />
    </header>
  );
}
