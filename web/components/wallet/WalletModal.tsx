'use client';

import { useEffect, useState, useCallback, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, ExternalLink, Smartphone } from 'lucide-react';
import { getSupportedWallets, connectWallet, WALLETCONNECT_ID, type SupportedWallet } from '@/lib/stellar/walletKit';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected: (address: string, walletId?: string) => void;
}

export function WalletModal({ isOpen, onClose, onConnected }: WalletModalProps) {
  const [wallets, setWallets] = useState<SupportedWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  // When WalletConnect is selected we hide our modal so its QR modal (z-index 9999) is visible
  const [hiddenForWC, setHiddenForWC] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Move focus into the dialog on open; restore it to the trigger on close.
  useEffect(() => {
    if (!isOpen) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      panelRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setHiddenForWC(false);
      return;
    }
    setLoading(true);
    setError(null);
    getSupportedWallets()
      .then(setWallets)
      .catch(() => setError('Failed to load wallets'))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const handleSelect = useCallback(
    async (wallet: SupportedWallet) => {
      if (connectingId) return;

      // For unavailable non-WC wallets, don't attempt connect
      if (!wallet.isAvailable && wallet.id !== WALLETCONNECT_ID) return;

      setConnectingId(wallet.id);
      setError(null);

      // Hide our modal for WalletConnect so its QR code modal shows cleanly
      if (wallet.id === WALLETCONNECT_ID) {
        setHiddenForWC(true);
      }

      try {
        const { address, walletId } = await connectWallet(wallet.id);
        onConnected(address, walletId);
        onClose();
      } catch (err) {
        setHiddenForWC(false);
        setError(err instanceof Error ? err.message : 'Connection failed');
      } finally {
        setConnectingId(null);
      }
    },
    [connectingId, onConnected, onClose]
  );

  // Close on Escape key; trap Tab inside the dialog
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null
        );
        if (focusable.length === 0) {
          e.preventDefault();
          panel.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (!panel.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && (active === first || active === panel)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!mounted) return null;

  // Sort wallets: WalletConnect first (for mobile), then available, then unavailable
  const sortedWallets = [...wallets].sort((a, b) => {
    if (a.id === WALLETCONNECT_ID) return -1;
    if (b.id === WALLETCONNECT_ID) return 1;
    if (a.isAvailable && !b.isAvailable) return -1;
    if (!a.isAvailable && b.isAvailable) return 1;
    return 0;
  });

  const wcWallet = sortedWallets.find(w => w.id === WALLETCONNECT_ID);
  const otherWallets = sortedWallets.filter(w => w.id !== WALLETCONNECT_ID);

  return createPortal(
    <AnimatePresence>
      {isOpen && !hiddenForWC && (
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
            className="fixed inset-0 z-[101] flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={onClose}
          >
            <div
              ref={panelRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="relative w-full sm:max-w-[480px] max-h-[85dvh] bg-[#111114] border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col outline-none"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] flex-shrink-0">
                <h2 id={titleId} className="text-base font-bold text-white">Connect Wallet</h2>
                <button
                  onClick={onClose}
                  aria-label="Close dialog"
                  className="p-1.5 text-neutral-500 hover:text-white transition-colors rounded-lg hover:bg-white/5"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-4">
                {error && (
                  <div className="mb-3 px-3 py-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg">
                    {error}
                  </div>
                )}

                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 text-neutral-500 animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* WalletConnect - Highlighted for mobile */}
                    {wcWallet && (
                      <button
                        onClick={() => handleSelect(wcWallet)}
                        disabled={connectingId !== null}
                        className="w-full flex items-center gap-4 px-4 py-4 rounded-xl bg-[#eab308]/10 border border-[#eab308]/20 hover:bg-[#eab308]/15 transition-all cursor-pointer"
                      >
                        <div className="w-10 h-10 rounded-full bg-[#eab308]/20 flex items-center justify-center flex-shrink-0">
                          {wcWallet.icon ? (
                            // eslint-disable-next-line @next/next/no-img-element -- dynamic wallet icon (data URI / remote) from stellar-wallets-kit; next/image is unsuitable
                            <img src={wcWallet.icon} alt={wcWallet.name} className="w-6 h-6 object-contain" />
                          ) : (
                            <Smartphone className="w-5 h-5 text-[#eab308]" />
                          )}
                        </div>
                        <div className="flex-1 text-left">
                          <span className="text-sm font-medium text-white block">WalletConnect</span>
                          <span className="text-xs text-neutral-400">LOBSTR, Freighter & more</span>
                        </div>
                        {connectingId === wcWallet.id ? (
                          <Loader2 className="w-4 h-4 text-[#eab308] animate-spin" />
                        ) : (
                          <span className="px-2.5 py-1 text-[10px] font-medium text-[#eab308] border border-[#eab308]/30 rounded-full">
                            Mobile
                          </span>
                        )}
                      </button>
                    )}

                    {/* Divider */}
                    {wcWallet && otherWallets.length > 0 && (
                      <div className="flex items-center gap-3 py-1">
                        <div className="flex-1 h-px bg-white/[0.06]" />
                        <span className="text-[10px] text-neutral-500 uppercase tracking-wider">Extensions</span>
                        <div className="flex-1 h-px bg-white/[0.06]" />
                      </div>
                    )}

                    {/* Other wallets */}
                    <div className="space-y-0.5">
                      {otherWallets.map((wallet) => {
                        const identity = (
                          <>
                            <div className="w-9 h-9 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center overflow-hidden flex-shrink-0">
                              {wallet.icon ? (
                                // eslint-disable-next-line @next/next/no-img-element -- dynamic wallet icon (data URI / remote) from stellar-wallets-kit; next/image is unsuitable
                                <img src={wallet.icon} alt={wallet.name} className="w-5 h-5 object-contain" />
                              ) : (
                                <span className="text-xs font-bold text-neutral-500">{wallet.name.charAt(0)}</span>
                              )}
                            </div>
                            <span className="text-sm font-medium text-white flex-1 text-left">{wallet.name}</span>
                          </>
                        );

                        if (!wallet.isAvailable) {
                          // Not installed: keep the Install link outside any disabled control
                          // so it stays keyboard-reachable (an <a> inside a disabled <button> is invalid HTML)
                          return (
                            <div
                              key={wallet.id}
                              className="w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all"
                            >
                              <div className="flex items-center gap-4 flex-1 opacity-40">{identity}</div>
                              <a
                                href={wallet.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Install ${wallet.name}`}
                                className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-neutral-500 border border-white/10 rounded-full hover:text-white hover:border-white/20 transition-colors"
                              >
                                Install
                                <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
                              </a>
                            </div>
                          );
                        }

                        return (
                          <button
                            key={wallet.id}
                            onClick={() => handleSelect(wallet)}
                            disabled={connectingId !== null}
                            className="w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all hover:bg-white/[0.05] cursor-pointer"
                          >
                            {identity}
                            {connectingId === wallet.id && (
                              <Loader2 className="w-4 h-4 text-[#eab308] animate-spin" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
