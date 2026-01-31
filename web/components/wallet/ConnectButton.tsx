'use client';

import { useState } from 'react';
import { Wallet, ChevronDown, LogOut, Copy, ExternalLink, Check, RefreshCw, ArrowLeftRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWallet } from '@/lib/hooks/useWallet';
import { useWalletContext } from './WalletProvider';
import { truncateAddress, formatNumber } from '@/lib/utils';
import { cn } from '@/lib/utils/cn';

export function ConnectButton() {
  const { isReady, hasFreighter, refreshBalance } = useWalletContext();
  const {
    isConnected,
    isConnecting,
    address,
    xlmBalance,
    usdcBalance,
    connect,
    disconnect,
  } = useWallet();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleConnect = async () => {
    try {
      await connect();
    } catch (error) {
      console.error('Connection failed:', error);
    }
  };

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
    disconnect();
    setIsDropdownOpen(false);

    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      await connect();
    } catch (error) {
      console.error('Failed to refresh wallet:', error);
    }
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

  // Freighter not installed
  if (!hasFreighter) {
    return (
      <a
        href="https://freighter.app"
        target="_blank"
        rel="noopener noreferrer"
        className={buttonBaseClass}
      >
        <Wallet className="w-4 h-4" />
        Install Freighter
      </a>
    );
  }

  // Not connected
  if (!isConnected) {
    return (
      <button
        className={cn(buttonBaseClass, isConnecting && 'opacity-70 cursor-wait')}
        onClick={handleConnect}
        disabled={isConnecting}
      >
        <Wallet className="w-4 h-4" />
        {isConnecting ? 'Connecting...' : 'Connect Wallet'}
      </button>
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
              {/* Network Badge */}
              <div className="flex items-center gap-2 mb-3">
                <div className="px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded-md">
                  <span className="text-xs font-medium text-amber-400">Testnet</span>
                </div>
                <span className="text-xs text-neutral-500">Stellar Network</span>
              </div>

              {/* Address */}
              <div className="mb-4">
                <p className="text-xs text-neutral-500 mb-1">Connected Address</p>
                <div className="flex items-center gap-2">
                  <code className="text-sm text-white font-mono">
                    {truncateAddress(address!, 8, 8)}
                  </code>
                  <button
                    onClick={handleCopyAddress}
                    className="p-1 text-neutral-400 hover:text-white transition-colors"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Balances */}
              <div className="mb-4 space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-neutral-500">Balances</p>
                  <button
                    onClick={handleRefreshBalance}
                    disabled={isRefreshing}
                    className="p-1 text-neutral-400 hover:text-white transition-colors disabled:opacity-50"
                    title="Refresh balances"
                  >
                    <RefreshCw className={cn('w-3 h-3', isRefreshing && 'animate-spin')} />
                  </button>
                </div>

                {/* USDC Balance - Primary for Trading */}
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-white">$</span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {formatNumber(usdcBalance, 2)} USDC
                        </p>
                        <p className="text-[10px] text-emerald-400">Trading Collateral</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* XLM Balance - For Gas */}
                <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-white">★</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">
                          {formatNumber(xlmBalance, 2)} XLM
                        </p>
                        <p className="text-[10px] text-neutral-500">Gas Fees</p>
                      </div>
                    </div>
                    {xlmBalance < 1 && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded">Low</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-1">
                <button
                  onClick={handleRefreshWallet}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                >
                  <ArrowLeftRight className="w-4 h-4" />
                  Refresh Wallet
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

              {/* Hint */}
              <p className="mt-3 text-xs text-neutral-600 text-center">
                Account changes auto-detected
              </p>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
