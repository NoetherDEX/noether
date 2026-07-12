'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import {
  captureReferralFromLocation,
  clearPendingReferral,
  getPendingReferral,
  isPendingReferralParked,
  parkPendingReferral,
} from '@/lib/referralCode';
import { lookupReferralCode } from '@/lib/api/referral';
import { useWalletStore } from '@/lib/store';
import { useWalletContext } from '@/components/wallet/WalletProvider';
import type { ReferrerRow } from '@/types/referral';
import toast from 'react-hot-toast';

// Lazy chunk: the wallet picker only loads if a disconnected visitor actually
// clicks the connect CTA (the banner mounts in the root layout on every page).
const WalletModal = dynamic(
  () => import('@/components/wallet/WalletModal').then((m) => m.WalletModal),
  { ssr: false },
);

/**
 * Floating notification card shown in the bottom-right corner whenever
 * a `?ref=CODE` is pending in localStorage.
 *
 *  - On mount: captures `?ref=` from URL (one-shot), parks it in
 *    localStorage, strips the query param so refreshes don't re-trigger.
 *  - Resolves the code to a referrer via the public API (best-effort —
 *    the on-chain bind doesn't need this to succeed).
 *  - When a wallet is connected, exposes a 'Bind referral code' CTA
 *    that calls `referral.set_referrer(referee, code)` on-chain; when
 *    disconnected, the CTA opens the wallet picker instead.
 *  - Animates in from the bottom, persists across page navigations,
 *    survives refresh. Dismissing PARKS the code (redeemable later via
 *    /referrals); only a successful bind clears it.
 */
export function ReferralBanner() {
  const wallet = useWalletStore();
  const { refreshBalance } = useWalletContext();
  const [code, setCode] = useState<string | null>(null);
  const [referrer, setReferrer_] = useState<ReferrerRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Cheap fade-in: render after mount.
  const [shown, setShown] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  // Mount the (lazy) wallet modal only after the first connect click.
  const [connectMounted, setConnectMounted] = useState(false);

  useEffect(() => {
    captureReferralFromLocation();
    if (isPendingReferralParked()) return;
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
      // Park, don't delete — dismissal must never forfeit attribution.
      parkPendingReferral();
      setCode(null);
    }, 200);
    toast('Invite saved — enter the code anytime on the Referrals page.');
  }

  function openConnect() {
    setConnectMounted(true);
    setConnectOpen(true);
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
      // bundle — it only loads when the user actually binds the code.
      const { setReferrer } = await import('@/lib/stellar/referral');
      await setReferrer(wallet.address, code);
      toast.success(`Referral code ${code} bound on-chain`);
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
        // Below lg sit above the fixed MobileTradeBar (~68px + its own
        // safe-area inset), so the Long/Short bar is never covered or
        // tap-blocked; from lg the bar is hidden → bottom-4.
        'fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] lg:bottom-4 right-4 z-50 w-[calc(100%-2rem)] max-w-sm',
        'transition-[opacity,transform] duration-300 ease-out',
        shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none',
      ].join(' ')}
      role="dialog"
      aria-label="Referral invitation"
    >
      <div className="rounded-lg border border-border-strong bg-surface overflow-hidden">
        {/* Top accent bar */}
        <div className="h-0.5 bg-primary/60" />

        {done ? (
          <div className="p-5 text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-long/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-long" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-sm font-medium">Referral code bound on-chain</p>
            <p className="text-xs text-muted-foreground">
              Your 4% fee discount activates when fee accrual ships in v1.1.
            </p>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* Header row: dismiss button */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <span className="text-[11px] uppercase tracking-wide text-primary font-medium">
                  Referral · Invitation
                </span>
                <h3 className="mt-1 text-sm font-medium leading-tight">
                  You were invited to Noether
                </h3>
              </div>
              <button
                onClick={dismiss}
                disabled={busy}
                aria-label="Dismiss"
                className="flex-none -mt-1 -mr-1 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-3 transition-colors disabled:opacity-40"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Referrer details */}
            <div className="rounded-md border border-border bg-surface-2 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Code</span>
                <code className="px-2 py-0.5 rounded-sm bg-surface-3 font-mono text-foreground">
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
                  <span className="text-foreground font-mono tabular-nums">{referrer.referredCount}</span>
                </div>
              )}
            </div>

            {/* Benefit + CTA */}
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-medium font-mono tabular-nums text-primary">4%</span>
                <span className="text-sm text-muted-foreground">off every trade — from v1.1</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {wallet.address
                  ? 'Sign one transaction to bind this code to your wallet on-chain. The fee discount activates in v1.1.'
                  : 'Connect your wallet to bind the code.'}
              </p>
            </div>

            <Button
              onClick={wallet.address ? bind : openConnect}
              disabled={busy}
              className={cn(
                'w-full',
                // Brand-gold connect CTA (matches the app's connect treatment).
                !wallet.address &&
                  'bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-primary rounded-md',
              )}
            >
              {busy
                ? 'Signing…'
                : wallet.address
                ? 'Bind referral code'
                : 'Connect wallet to bind'}
            </Button>
          </div>
        )}
      </div>

      {connectMounted && (
        <WalletModal
          isOpen={connectOpen}
          onClose={() => setConnectOpen(false)}
          onConnected={(address, walletId) => {
            // Light-weight connect completion (useWallet would drag
            // stellar-sdk into the layout bundle): set the store, then let
            // the global provider fetch balances.
            wallet.setConnected(address, address, walletId);
            void refreshBalance();
          }}
        />
      )}
    </div>
  );
}
