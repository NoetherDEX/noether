'use client';

import { useState } from 'react';
import { Wallet, ChevronDown, LogOut, Copy, ExternalLink, Check, RefreshCw, ArrowLeftRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWallet } from '@/lib/hooks/useWallet';
import { useWalletContext } from './WalletProvider';
import { WalletModal } from './WalletModal';
import { truncateAddress, formatNumber } from '@/lib/utils';
import { cn } from '@/lib/utils/cn';

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

  const handleDisconnect = () => {
    disconnect();
    setIsDropdownOpen(false);
  };

  const handleRefreshWallet = async () => {
    await disconnect();
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

  const buttonBaseClass =
    'inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold border border-[#eab308]/60 text-[#eab308] bg-transparent hover:bg-[#eab308]/10 hover:border-[#eab308] hover:-translate-y-0.5 transition-all';

  // Loading state
  if (!isReady) {
    return (
      <button className={cn(buttonBaseClass, 'opacity-70 cursor-wait')} disabled>
        <Wallet className="w-4 h-4" />
        Loading...
      </button>
    );
  }

  // Not connected
  if (!isConnected) {
    return (
      <>
        <button
          className={cn(buttonBaseClass, isConnecting && 'opacity-70 cursor-wait')}
          onClick={() => setIsModalOpen(true)}
          disabled={isConnecting}
        >
          <Wallet className="w-4 h-4" />
          {isConnecting ? 'Connecting...' : 'Connect Wallet'}
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
        className={cn(buttonBaseClass, 'pr-4')}
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
      >
        <div className="relative flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-[#22c55e]" />
          <div className="absolute w-2 h-2 rounded-full bg-[#22c55e] animate-ping opacity-75" />
        </div>
        <span>{truncateAddress(address!, 4, 4)}</span>
        <ChevronDown
          className={cn(
            'w-4 h-4 transition-transform',
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
              className="absolute right-0 mt-2 w-72 p-4 bg-[#0a0a0c] border border-white/10 rounded-xl shadow-2xl z-50"
            >
              {/* Network */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-neutral-500">Stellar Testnet</span>
                <button
                  onClick={handleRefreshBalance}
                  disabled={isRefreshing}
                  className="p-1 text-neutral-500 hover:text-white transition-colors disabled:opacity-50"
                  title="Refresh balances"
                >
                  <RefreshCw className={cn('w-3 h-3', isRefreshing && 'animate-spin')} />
                </button>
              </div>

              {/* Address */}
              <div className="mb-4">
                <div className="flex items-center gap-2">
                  <code className="text-sm text-white font-mono">
                    {truncateAddress(address!, 8, 8)}
                  </code>
                  <button
                    onClick={handleCopyAddress}
                    className="p-1 text-neutral-500 hover:text-white transition-colors"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-[#22c55e]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Balances */}
              <div className="mb-4 space-y-2">
                <div className="flex items-center justify-between p-3 bg-white/[0.03] border border-white/[0.06] rounded-lg">
                  <span className="text-sm font-mono text-white">{formatNumber(usdcBalance, 2)} USDC</span>
                  <span className="text-[10px] text-neutral-500">Collateral</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-white/[0.03] border border-white/[0.06] rounded-lg">
                  <span className="text-sm font-mono text-white">{formatNumber(xlmBalance, 2)} XLM</span>
                  <div className="flex items-center gap-2">
                    {xlmBalance < 1 && (
                      <span className="text-[10px] text-red-400">Low</span>
                    )}
                    <span className="text-[10px] text-neutral-500">Gas</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={handleRefreshWallet}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                >
                  <ArrowLeftRight className="w-4 h-4" />
                  Switch Wallet
                </button>
                <a
                  href={`https://stellar.expert/explorer/testnet/account/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  View on Explorer
                </a>
                <div className="border-t border-white/5 my-1" />
                <button
                  onClick={handleDisconnect}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
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
