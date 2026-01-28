'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { Menu, X } from 'lucide-react';

const navLinks = [
  { href: '/trade', label: 'Trade' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/vault', label: 'Vault' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/faucet', label: 'Faucet' },
];

export function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'py-3' : 'py-5'}`}>
      <div className="max-w-7xl mx-auto px-6">
        <div
          className={`flex items-center justify-between px-6 py-3 rounded-2xl transition-all duration-300 ${
            scrolled
              ? 'bg-white/5 backdrop-blur-xl border border-white/10 shadow-lg shadow-violet-500/5'
              : 'bg-transparent'
          }`}
        >
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <img src="/logo.svg" alt="Noether" className="w-20 h-20" />
            <span className="text-xl font-bold tracking-wide">Noether</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Connect Wallet Button */}
          <div className="hidden md:block">
            <Link href="/trade" className="group relative px-5 py-2.5 rounded-xl overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-violet-500 to-cyan-500 opacity-80 group-hover:opacity-100 transition-opacity" />
              <div className="absolute inset-[1px] bg-[#051015] rounded-[10px] group-hover:bg-[#0a1628] transition-colors" />
              <span className="relative text-sm font-medium bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
                Launch App
              </span>
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden p-2 text-gray-400 hover:text-white transition-colors"
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? (
              <X className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </button>
        </div>

        {/* Mobile Navigation */}
        {isMobileMenuOpen && (
          <div className="md:hidden mt-2 p-4 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10">
            <div className="flex flex-col gap-2">
              {navLinks.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="text-gray-400 hover:text-white transition-colors text-sm py-2 px-4 rounded-lg hover:bg-white/5"
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/trade"
                onClick={() => setIsMobileMenuOpen(false)}
                className="mt-2 px-5 py-2.5 bg-gradient-to-r from-violet-500 to-cyan-500 text-white rounded-xl font-medium text-sm text-center"
              >
                Launch App
              </Link>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
