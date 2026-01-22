'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';

const navLinks = [
  { href: '/trade', label: 'Trade' },
  { href: '/vault', label: 'Vault' },
  { href: '/faucet', label: 'Faucet' },
  { href: '#', label: 'Docs', external: true },
];

export function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#051015]/90 backdrop-blur-xl border-b border-white/5">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center">
            <span className="text-white font-mono tracking-[0.3em] text-lg font-medium">
              NOETHER
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-gray-400 hover:text-white transition-colors text-sm"
                {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Connect Wallet Button */}
          <div className="hidden md:block">
            <Link
              href="/trade"
              className="px-5 py-2.5 border border-[#00e6b8] text-[#00e6b8] hover:bg-[#00e6b8] hover:text-[#051015] rounded-lg font-medium text-sm transition-all duration-200"
            >
              Connect Wallet
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
          <div className="md:hidden pt-4 pb-2 border-t border-white/5 mt-4">
            <div className="flex flex-col gap-4">
              {navLinks.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="text-gray-400 hover:text-white transition-colors text-sm py-2"
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/trade"
                onClick={() => setIsMobileMenuOpen(false)}
                className="px-5 py-2.5 border border-[#00e6b8] text-[#00e6b8] hover:bg-[#00e6b8] hover:text-[#051015] rounded-lg font-medium text-sm transition-all duration-200 text-center mt-2"
              >
                Connect Wallet
              </Link>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
