'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Landmark, BookOpen, Menu, X, Loader2, Droplets } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { ConnectButton } from '@/components/wallet';
import { useWallet } from '@/lib/hooks/useWallet';
import { cn } from '@/lib/utils/cn';

const navItems = [
  { href: '/trade', label: 'Trade', icon: BarChart3 },
  { href: '/vault', label: 'Vault', icon: Landmark },
  { href: '/docs', label: 'Docs', icon: BookOpen, external: true },
];

export function Header() {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMinting, setIsMinting] = useState(false);
  const { isConnected, publicKey, refreshBalances } = useWallet();

  // Handle faucet mint
  const handleMintTestUSDC = async () => {
    if (!publicKey) return;

    setIsMinting(true);

    try {
      const response = await fetch('/api/faucet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientAddress: publicKey }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to mint test USDC');
      }

      toast.success('Received 10,000 test USDC!');
      refreshBalances();
    } catch (error) {
      console.error('Faucet error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to get test USDC');
    } finally {
      setIsMinting(false);
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[#09090b]/90 backdrop-blur-xl border-b border-white/5">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center font-bold text-black">
              N
            </div>
            <span className="text-xl font-semibold text-white">Noether</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;

              if (item.external) {
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                      'text-neutral-400 hover:text-white hover:bg-white/5'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </a>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                    isActive
                      ? 'text-white bg-white/10'
                      : 'text-neutral-400 hover:text-white hover:bg-white/5'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Network indicator */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-xs text-neutral-400">Testnet</span>
            </div>

            {/* Faucet Button - Always visible when connected */}
            {isConnected && (
              <button
                onClick={handleMintTestUSDC}
                disabled={isMinting}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                  'bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 hover:border-blue-500/30',
                  'text-blue-400 hover:text-blue-300',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
                title="Mint 10,000 test USDC"
              >
                {isMinting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Droplets className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">Mint USDC</span>
              </button>
            )}

            {/* Wallet */}
            <ConnectButton />

            {/* Mobile menu button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 text-neutral-400 hover:text-white transition-colors"
            >
              {isMobileMenuOpen ? (
                <X className="w-6 h-6" />
              ) : (
                <Menu className="w-6 h-6" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {isMobileMenuOpen && (
          <nav className="md:hidden py-4 border-t border-white/5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 text-sm font-medium rounded-lg transition-colors',
                    isActive
                      ? 'text-white bg-white/10'
                      : 'text-neutral-400 hover:text-white hover:bg-white/5'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </header>
  );
}
