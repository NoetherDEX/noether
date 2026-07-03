'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import {
  captureReferralFromLocation,
  clearPendingReferral,
  getPendingReferral,
} from '@/lib/referralCode';
import { lookupReferralCode } from '@/lib/api/referral';
import { useWalletStore } from '@/lib/store';
import type { ReferrerRow } from '@/types/referral';
import toast from 'react-hot-toast';

/**
 * Floating notification card shown in the bottom-right corner whenever
 * a `?ref=CODE` is pending in localStorage.
 *
 *  - On mount: captures `?ref=` from URL (one-shot), parks it in
 *    localStorage, strips the query param so refreshes don't re-trigger.
 *  - Resolves the code to a referrer via the public API (best-effort —
 *    the on-chain bind doesn't need this to succeed).
 *  - When a wallet is connected, exposes a 'Lock in referral' CTA
 *    that calls `referral.set_referrer(referee, code)` on-chain. Binding is
 *    live today; the 4% discount itself activates in v1.1.
 *  - Animates in from the bottom, persists across page navigations,
 *    survives refresh — only goes away when the user dismisses it or
 *    a bind tx succeeds.
 */
export function ReferralBanner() {
  const wallet = useWalletStore();
  const [code, setCode] = useState<string | null>(null);
  const [referrer, setReferrer_] = useState<ReferrerRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Cheap fade-in: render after mount.
  const [shown, setShown] = useState(false);

  useEffect(() => {
    captureReferralFromLocation();
    const pending = getPendingReferral();
    if (!pending) return;
    setCode(pending);
    // Tiny delay so the slide-in is visible.
    requestAnimationFrame(() => setShown(true));
    void lookupReferralCode(pending)
      .then((row) => setReferrer_(row))
      .catch(() => {
        // Best-effort — banner stays even if the lookup endpoint is down.
      });
  }, []);

  if (!code) return null;

  function dismiss() {
    setShown(false);
    setTimeout(() => {
      clearPendingReferral();
      setCode(null);
    }, 200);
  }

  async function bind() {
    if (!wallet.address || !wallet.walletId) {
      return toast.error('Connect a wallet first');
    }
    if (!code) return;
    setBusy(true);
    try {
      // Lazy-load the on-chain referral binding so @stellar/stellar-sdk
      // (via lib/stellar/referral → client.ts) stays out of the initial
      // bundle — it only loads when the user actually claims the discount.
      const { setReferrer } = await import('@/lib/stellar/referral');
      await setReferrer(wallet.address, code);
      toast.success(`Referral code ${code} linked — 4% discount activates in v1.1`);
      setDone(true);
      // Slide out after a brief celebratory pause.
      setTimeout(() => {
        clearPendingReferral();
        setCode(null);
      }, 1800);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      let friendly = msg;
      if (/Error\(Contract, #10\)/.test(msg)) friendly = 'That referral code does not exist.';
      else if (/Error\(Contract, #11\)/.test(msg)) friendly = 'You already have a referrer bound to your wallet.';
      else if (/Error\(Contract, #12\)/.test(msg)) friendly = "You can't refer yourself.";
      toast.error(friendly.slice(0, 200));
    } finally {
      setBusy(false);
    }
  }

  const referrerAddr = referrer?.referrer
    ? `${referrer.referrer.slice(0, 4)}…${referrer.referrer.slice(-4)}`
    : null;

  return (
    <div
      data-noether-chrome
      className={[
        'fixed bottom-4 right-4 z-50 w-[calc(100%-2rem)] max-w-sm',
        'transition-all duration-300 ease-out',
        shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none',
      ].join(' ')}
      role="dialog"
      aria-label="Referral invitation"
    >
      <div className="rounded-2xl border border-white/10 bg-[#0a0a0a]/95 backdrop-blur-md shadow-2xl shadow-black/40 overflow-hidden">
        {/* Top accent bar */}
        <div className="h-1 bg-gradient-to-r from-amber-500/40 via-amber-400 to-amber-500/40" />

        {done ? (
          <div className="p-5 text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <svg className="w-6 h-6 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-sm font-medium">Referral code linked</p>
            <p className="text-xs text-muted-foreground">
              Your 4% trading discount activates in v1.1.
            </p>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* Header row: dismiss button */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <span className="text-[10px] uppercase tracking-[0.18em] text-amber-400 font-medium">
                  Referral · Invitation
                </span>
                <h3 className="mt-1 text-base font-semibold leading-tight">
                  You were invited to Noether
                </h3>
              </div>
              <button
                onClick={dismiss}
                disabled={busy}
                aria-label="Dismiss"
                className="flex-none -mt-1 -mr-1 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors disabled:opacity-40"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Referrer details */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Code</span>
                <code className="px-2 py-0.5 rounded bg-zinc-900 font-mono text-foreground">
                  {code}
                </code>
              </div>
              {referrerAddr && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Referrer</span>
                  <span className="font-mono text-foreground">{referrerAddr}</span>
                </div>
              )}
              {referrer && referrer.referredCount > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Other referees</span>
                  <span className="text-foreground">{referrer.referredCount}</span>
                </div>
              )}
            </div>

            {/* Benefit + CTA */}
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-amber-400">4%</span>
                <span className="text-sm text-muted-foreground">off every trade — activates in v1.1</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {wallet.address
                  ? 'Sign one transaction to bind this code to your wallet on-chain now — the discount applies once it goes live.'
                  : 'Connect your wallet to lock in this code.'}
              </p>
            </div>

            <Button
              onClick={bind}
              disabled={busy || !wallet.address}
              className="w-full"
            >
              {busy
                ? 'Signing…'
                : wallet.address
                ? 'Lock in referral'
                : 'Connect wallet to lock in'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
