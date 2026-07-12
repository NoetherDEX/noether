'use client';

import { useState } from 'react';
import { Wallet, ChevronDown, LogOut, Copy, ExternalLink, Check, RefreshCw, ArrowLeftRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWallet } from '@/lib/hooks/useWallet';
import { useWalletContext } from './WalletProvider';
import { WalletModal } from './WalletModal';
import { truncateAddress, formatNumber } from '@/lib/utils';
import { cn } from '@/lib/utils/cn';
import { STELLAR_EXPERT_BASE } from '@/lib/utils/constants';
import { useSessionAuthStore } from '@/lib/store';

export function ConnectButton() {
  const { isReady, refreshBalance } = useWalletContext();
  const {
    isConnected,
    isConnecting,
    address,
    xlmBalance,
    usdcBalance,
    onConnected,
    disconnect,
  } = useWallet();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleCopyAddress = async () => {
    if (address) {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const clearSessionAuth = useSessionAuthStore((s) => s.clearAuth);

  const handleDisconnect = () => {
    disconnect();
    clearSessionAuth();
    setIsDropdownOpen(false);
  };

  const handleRefreshWallet = async () => {
    await disconnect();
    clearSessionAuth();
    setIsDropdownOpen(false);
    setIsModalOpen(true);
  };

  const handleRefreshBalance = async () => {
    setIsRefreshing(true);
    try {
      await refreshBalance();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Disconnected: the one gold CTA in the shell. Connected: quiet surface chip.
  const ctaClass =
    'inline-flex items-center gap-1.5 h-8 px-3 sm:px-4 rounded-md text-xs sm:text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors';
  const chipClass =
    'inline-flex items-center gap-2 h-8 px-3 rounded-md text-xs sm:text-[13px] font-medium bg-surface-2 text-foreground border border-border-strong hover:bg-surface-3 transition-colors';

  // Loading state
  if (!isReady) {
    return (
      <button className={cn(ctaClass, 'opacity-70 cursor-wait')} disabled>
        <Wallet className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Loading…</span>
      </button>
    );
  }

  // Not connected
  if (!isConnected) {
    return (
      <>
        <button
          className={cn(ctaClass, isConnecting && 'opacity-70 cursor-wait')}
          onClick={() => setIsModalOpen(true)}
          disabled={isConnecting}
        >
          <Wallet className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{isConnecting ? 'Connecting…' : 'Connect Wallet'}</span>
          <span className="sm:hidden">{isConnecting ? '…' : 'Connect'}</span>
        </button>

        <WalletModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onConnected={onConnected}
        />
      </>
    );
  }

  // Connected - show dropdown
  return (
    <div className="relative">
      <button
        className={chipClass}
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        aria-expanded={isDropdownOpen}
        aria-haspopup="menu"
      >
        <div className="w-1.5 h-1.5 rounded-full bg-long" />
        <span className="font-mono">{truncateAddress(address!, 4, 4)}</span>
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 text-muted-foreground transition-transform',
            isDropdownOpen && 'rotate-180'
          )}
        />
      </button>

      <AnimatePresence>
        {isDropdownOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsDropdownOpen(false)}
            />

            {/* Dropdown */}
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 mt-2 w-[calc(100vw-2rem)] sm:w-72 max-w-72 p-3 bg-surface-2 border border-border-strong rounded-lg z-50"
            >
              {/* Network */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-faint">Stellar Testnet</span>
                <button
                  onClick={handleRefreshBalance}
                  disabled={isRefreshing}
                  className="p-1 text-faint hover:text-foreground transition-colors disabled:opacity-50"
                  title="Refresh balances"
                >
                  <RefreshCw className={cn('w-3 h-3', isRefreshing && 'animate-spin')} />
                </button>
              </div>

              {/* Address */}
              <div className="mb-3">
                <div className="flex items-center gap-2">
                  <code className="text-sm text-foreground font-mono">
                    {truncateAddress(address!, 8, 8)}
                  </code>
                  <button
                    onClick={handleCopyAddress}
                    aria-label={copied ? 'Address copied' : 'Copy address'}
                    className="p-1 text-faint hover:text-foreground transition-colors"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-long" aria-hidden="true" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              {/* Balances */}
              <div className="mb-3 space-y-1.5">
                <div className="flex items-center justify-between px-3 py-2 bg-surface border border-border rounded-md">
                  <span className="text-sm font-mono text-foreground">{formatNumber(usdcBalance, 2)} USDC</span>
                  <span className="text-[10px] text-faint">Collateral</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 bg-surface border border-border rounded-md">
                  <span className="text-sm font-mono text-foreground">{formatNumber(xlmBalance, 2)} XLM</span>
                  <div className="flex items-center gap-2">
                    {xlmBalance < 1 && (
                      <span className="text-[10px] text-short">Low</span>
                    )}
                    <span className="text-[10px] text-faint">Gas</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={handleRefreshWallet}
                  className="flex items-center gap-2 px-2.5 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-surface-3 rounded-md transition-colors"
                >
                  <ArrowLeftRight className="w-4 h-4" />
                  Switch Wallet
                </button>
                <a
                  href={`${STELLAR_EXPERT_BASE}/account/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-2.5 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-surface-3 rounded-md transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  View on Explorer
                </a>
                <div className="border-t border-border my-1" />
                <button
                  onClick={handleDisconnect}
                  className="flex items-center gap-2 px-2.5 py-2 text-[13px] text-short hover:bg-short/10 rounded-md transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Disconnect
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Modal for switching wallet */}
      <WalletModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConnected={onConnected}
      />
    </div>
  );
}
