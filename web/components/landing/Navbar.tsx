'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { NoetherLogo } from './NoetherLogo';

const NAV_LINKS = [
  { href: '/trade', label: 'Trade' },
  { href: '/vault', label: 'Vault' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/faucet', label: 'Faucet' },
];

export function Navbar() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleScroll = useCallback(() => {
    const sections = document.querySelectorAll('.snap-section');
    const container = document.querySelector('.snap-container');
    if (!container) return;

    const scrollTop = container.scrollTop;
    const viewportHeight = window.innerHeight;

    let currentTheme: 'dark' | 'light' = 'dark';
    sections.forEach((section) => {
      const el = section as HTMLElement;
      const sectionTop = el.offsetTop;
      if (scrollTop >= sectionTop - viewportHeight / 2) {
        currentTheme = el.classList.contains('section-light') ? 'light' : 'dark';
      }
    });

    setTheme(currentTheme);
  }, []);

  useEffect(() => {
    const container = document.querySelector('.snap-container');
    if (!container) return;

    container.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const isDark = theme === 'dark';

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-colors duration-300 ${isDark ? 'navbar-dark' : 'navbar-light'}`}>
      <div className="max-w-[1400px] mx-auto px-6 py-4">
        <div
          className={`flex items-center justify-between rounded-full px-6 py-3 border backdrop-blur-xl transition-all duration-300 ${
            isDark
              ? 'border-[#eab308]/30 bg-black/20'
              : 'border-black/10 bg-white/70'
          }`}
        >
          {/* Logo */}
          <Link href="/" className="flex-shrink-0">
            <NoetherLogo
              className={`h-6 w-auto transition-all duration-300 ${isDark ? 'text-white' : 'text-[#1a1a1a]'}`}
              maskColor={isDark ? '#050508' : '#f8f6f0'}
            />
          </Link>

          {/* Desktop Links */}
          <div className="hidden lg:flex items-center gap-8">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`nav-link text-sm transition-colors duration-200 ${
                  isDark ? 'text-[#eab308]/50 hover:text-[#eab308]' : 'text-black/50 hover:text-black'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Launch App CTA */}
          <div className="hidden lg:block">
            <Link
              href="/trade"
              className="pill-button pill-button-filled text-sm"
            >
              Launch App
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            className="lg:hidden flex flex-col gap-1.5 p-2"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            <span className={`block w-5 h-0.5 transition-all duration-200 ${isDark ? 'bg-white' : 'bg-black'} ${mobileOpen ? 'rotate-45 translate-y-2' : ''}`} />
            <span className={`block w-5 h-0.5 transition-all duration-200 ${isDark ? 'bg-white' : 'bg-black'} ${mobileOpen ? 'opacity-0' : ''}`} />
            <span className={`block w-5 h-0.5 transition-all duration-200 ${isDark ? 'bg-white' : 'bg-black'} ${mobileOpen ? '-rotate-45 -translate-y-2' : ''}`} />
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          className={`lg:hidden border backdrop-blur-xl mx-6 rounded-2xl mt-1 p-6 ${
            isDark
              ? 'bg-black/90 border-white/10'
              : 'bg-white/90 border-black/10'
          }`}
        >
          <div className="flex flex-col gap-4">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-base transition-colors ${
                  isDark ? 'text-[#eab308]/60 hover:text-[#eab308]' : 'text-black/70 hover:text-black'
                }`}
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/trade"
              className="pill-button pill-button-filled text-sm mt-2 text-center"
              onClick={() => setMobileOpen(false)}
            >
              Launch App
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
