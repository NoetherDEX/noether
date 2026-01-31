'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { NoetherLogo } from './NoetherLogo';

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-[1000] px-8 py-4 flex items-center justify-between transition-all duration-300 ${
        scrolled
          ? 'bg-[#050508]/85 backdrop-blur-[20px] border-b border-white/[0.06]'
          : 'bg-transparent'
      }`}
    >
      <Link href="/" className="flex items-center gap-2">
        <NoetherLogo className="h-8 w-auto" />
      </Link>

      <div className="flex items-center gap-10">
        <Link
          href="/trade"
          className="nav-link relative text-white/60 text-sm font-medium hover:text-white transition-colors"
        >
          Trade
        </Link>
        <Link
          href="/portfolio"
          className="nav-link relative text-white/60 text-sm font-medium hover:text-white transition-colors"
        >
          Portfolio
        </Link>
        <Link
          href="/vault"
          className="nav-link relative text-white/60 text-sm font-medium hover:text-white transition-colors"
        >
          Vault
        </Link>
        <Link
          href="/leaderboard"
          className="nav-link relative text-white/60 text-sm font-medium hover:text-white transition-colors"
        >
          Leaderboard
        </Link>
        <Link
          href="/faucet"
          className="nav-link relative text-white/60 text-sm font-medium hover:text-white transition-colors"
        >
          Faucet
        </Link>
      </div>

      <Link
        href="/trade"
        className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold bg-gradient-to-r from-[#eab308] to-[#f59e0b] text-black hover:shadow-[0_4px_20px_rgba(234,179,8,0.3)] hover:-translate-y-0.5 transition-all"
      >
        Launch App
      </Link>
    </nav>
  );
}
