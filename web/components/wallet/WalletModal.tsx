'use client';

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { getSupportedWallets, connectWallet, type SupportedWallet } from '@/lib/stellar/walletKit';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected: (address: string) => void;
}

export function WalletModal({ isOpen, onClose, onConnected }: WalletModalProps) {
  const [wallets, setWallets] = useState<SupportedWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Wait for client-side mount before rendering portal
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    getSupportedWallets()
      .then(setWallets)
      .catch(() => setError('Failed to load wallets'))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const handleSelect = useCallback(
    async (wallet: SupportedWallet) => {
      if (!wallet.isAvailable || connectingId) return;
      setConnectingId(wallet.id);
      setError(null);
      try {
        const { address } = await connectWallet(wallet.id);
        onConnected(address);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Connection failed');
      } finally {
        setConnectingId(null);
      }
    },
    [connectingId, onConnected, onClose]
  );

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[101] flex items-center justify-center p-4"
          >
            <div
              className="relative w-full max-w-[820px] bg-[#111114] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 z-10 p-1.5 text-neutral-500 hover:text-white transition-colors rounded-lg hover:bg-white/5"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex flex-col md:flex-row">
                {/* Left column — Learn more */}
                <div className="md:w-[340px] p-8 border-b md:border-b-0 md:border-r border-white/[0.06]">
                  <h2 className="text-lg font-bold text-white mb-6">Learn more</h2>

                  <div className="mb-6">
                    <h3 className="text-sm font-semibold text-white mb-2">What is a Wallet?</h3>
                    <p className="text-sm text-neutral-400 leading-relaxed">
                      Wallets are used to send, receive, and store the keys you use to sign blockchain transactions.
                    </p>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-white mb-2">What is Stellar?</h3>
                    <p className="text-sm text-neutral-400 leading-relaxed">
                      Stellar is a decentralized, public blockchain that gives developers the tools to create experiences that are more like cash than crypto.
                    </p>
                  </div>
                </div>

                {/* Right column — Wallet list */}
                <div className="flex-1 p-8">
                  <h2 className="text-lg font-bold text-white mb-6">Connect a Wallet</h2>

                  {error && (
                    <div className="mb-4 px-3 py-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg">
                      {error}
                    </div>
                  )}

                  {loading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-6 h-6 text-neutral-500 animate-spin" />
                    </div>
                  ) : (
                    <div className="space-y-1 max-h-[400px] overflow-y-auto pr-1">
                      {wallets.map((wallet) => (
                        <button
                          key={wallet.id}
                          onClick={() => handleSelect(wallet)}
                          disabled={!wallet.isAvailable || connectingId !== null}
                          className={cn(
                            'w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all',
                            wallet.isAvailable
                              ? 'hover:bg-white/[0.05] cursor-pointer'
                              : 'opacity-50 cursor-not-allowed'
                          )}
                        >
                          {/* Wallet icon */}
                          <div className="w-10 h-10 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center overflow-hidden flex-shrink-0">
                            {wallet.icon ? (
                              <img
                                src={wallet.icon}
                                alt={wallet.name}
                                className="w-6 h-6 object-contain"
                              />
                            ) : (
                              <span className="text-sm font-bold text-neutral-500">
                                {wallet.name.charAt(0)}
                              </span>
                            )}
                          </div>

                          {/* Name */}
                          <span className="text-sm font-medium text-white flex-1 text-left">
                            {wallet.name}
                          </span>

                          {/* Status */}
                          {connectingId === wallet.id ? (
                            <Loader2 className="w-4 h-4 text-[#eab308] animate-spin" />
                          ) : !wallet.isAvailable ? (
                            <a
                              href={wallet.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-neutral-500 border border-white/10 rounded-full hover:text-white hover:border-white/20 transition-colors"
                            >
                              Not available
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
