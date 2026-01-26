'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Landmark, Droplets, Trophy, PieChart, Menu, X, Wallet, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useWallet } from '@/lib/hooks/useWallet';
import { cn } from '@/lib/utils/cn';

const navItems = [
  { href: '/trade', label: 'Trade', icon: BarChart3 },
  { href: '/portfolio', label: 'Portfolio', icon: PieChart },
  { href: '/vault', label: 'Vault', icon: Landmark },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { href: '/faucet', label: 'Faucet', icon: Droplets },
];

export function Header() {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { isConnected, publicKey, xlmBalance, usdcBalance, connect, disconnect, isConnecting } = useWallet();

  const formatAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-xl">
      <div className="flex h-full items-center justify-between px-4 max-w-[1800px] mx-auto">
        {/* Left Section - Logo */}
        <div className="flex items-center gap-6">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="relative h-8 w-8">
              <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-[#8b5cf6] to-[#3b82f6]" />
              <div className="absolute inset-[2px] rounded-md bg-[#0a0a0a] flex items-center justify-center">
                <span className="text-sm font-bold bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6] bg-clip-text text-transparent">
                  N
                </span>
              </div>
            </div>
            <span className="text-lg font-semibold text-foreground">Noether</span>
          </Link>
        </div>

        {/* Center Section - Navigation Links */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'px-4 py-2 text-sm font-medium rounded-lg transition-all',
                  isActive
                    ? 'text-foreground bg-white/5'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right Section - Network & Wallet */}
        <div className="flex items-center gap-4">
          {/* Network Status */}
          <div className="hidden sm:flex items-center gap-2 text-sm">
            <div className="relative">
              <div className="h-2 w-2 rounded-full bg-[#22c55e]" />
              <div className="absolute inset-0 h-2 w-2 rounded-full bg-[#22c55e] animate-ping opacity-75" />
            </div>
            <span className="text-muted-foreground">Stellar Testnet</span>
          </div>

          {isConnected && publicKey ? (
            <div className="relative group">
              <div className="relative p-[1px] rounded-lg bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6]">
                <button className="flex items-center gap-2 bg-[#0a0a0a] hover:bg-[#111] text-foreground rounded-[7px] px-4 py-2 transition-colors">
                  <div className="h-2 w-2 rounded-full bg-[#22c55e]" />
                  <span className="text-sm font-medium">{formatAddress(publicKey)}</span>
                </button>
              </div>

              {/* Dropdown */}
              <div className="absolute right-0 top-full mt-2 w-56 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                <div className="bg-card border border-white/10 rounded-lg shadow-xl overflow-hidden">
                  <div className="p-3 border-b border-white/10">
                    <p className="text-xs text-muted-foreground mb-1">Balance</p>
                    <p className="font-mono font-medium text-foreground">{xlmBalance.toLocaleString()} XLM</p>
                    <p className="font-mono text-sm text-muted-foreground">${usdcBalance.toLocaleString()} USDC</p>
                  </div>
                  <button
                    onClick={disconnect}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                    Disconnect
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative p-[1px] rounded-lg bg-gradient-to-r from-[#8b5cf6] to-[#3b82f6]">
              <button
                onClick={connect}
                disabled={isConnecting}
                className="flex items-center gap-2 bg-[#0a0a0a] hover:bg-[#111] text-foreground rounded-[7px] px-4 py-2 transition-colors disabled:opacity-50"
              >
                <Wallet className="h-4 w-4" />
                <span className="text-sm font-medium">
                  {isConnecting ? 'Connecting...' : 'Connect Wallet'}
                </span>
              </button>
            </div>
          )}

          {/* Mobile menu button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden p-2 text-muted-foreground hover:text-foreground transition-colors"
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
        <nav className="md:hidden py-4 px-4 border-t border-white/10 bg-[#0a0a0a]">
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
                    ? 'text-foreground bg-white/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                )}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
