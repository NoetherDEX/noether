'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import {
  captureReferralFromLocation,
  clearPendingReferral,
  getPendingReferral,
} from '@/lib/referralCode';
import { lookupReferralCode } from '@/lib/api/referral';
import { setReferrer } from '@/lib/stellar/referral';
import { useWalletStore } from '@/lib/store';
import type { ReferrerRow } from '@/types/referral';
import toast from 'react-hot-toast';

/**
 * Sticky banner shown across the app whenever a `?ref=CODE` is pending.
 *
 *  - On mount: captures `?ref=` from URL (one-shot) and parks it in
 *    localStorage; strips the query param so refreshes don't re-trigger.
 *  - Resolves the code to a referrer via the public lookup endpoint
 *    (best-effort; the on-chain bind doesn't need this to succeed).
 *  - Once the user has a wallet connected, exposes a "Bind referrer"
 *    button that calls `referral.set_referrer(referee, code)` on-chain.
 *    On success the localStorage entry is cleared and the banner
 *    disappears.
 *  - Survives every page refresh until either dismissed or successfully
 *    bound — so the user can navigate to /faucet, /trade, etc. and
 *    still see it.
 */
export function ReferralBanner() {
  const wallet = useWalletStore();
  const [code, setCode] = useState<string | null>(null);
  const [referrer, setReferrer_] = useState<ReferrerRow | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    captureReferralFromLocation();
    const pending = getPendingReferral();
    if (!pending) return;
    setCode(pending);
    void lookupReferralCode(pending)
      .then((row) => setReferrer_(row))
      .catch(() => {
        // lookup is best-effort — banner stays even if API is down.
      });
  }, []);

  if (!code) return null;

  function dismiss() {
    clearPendingReferral();
    setCode(null);
  }

  async function bind() {
    if (!wallet.address || !wallet.walletId) {
      return toast.error('Connect a wallet first');
    }
    if (!code) return;
    setBusy(true);
    try {
      await setReferrer(wallet.address, code);
      toast.success(`Bound to referral code ${code}`);
      clearPendingReferral();
      setCode(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Friendly mapping for the most common reverts.
      let friendly = msg;
      if (/Error\(Contract, #10\)/.test(msg)) friendly = 'That referral code does not exist.';
      else if (/Error\(Contract, #11\)/.test(msg)) friendly = 'You already have a referrer bound to your wallet.';
      else if (/Error\(Contract, #12\)/.test(msg)) friendly = 'You can\'t refer yourself.';
      toast.error(`Failed: ${friendly.slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed top-16 left-0 right-0 z-40 px-4">
      <div className="max-w-7xl mx-auto mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 backdrop-blur-sm">
        <div className="px-4 md:px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm flex-1 min-w-[260px]">
            <p>
              <span className="text-amber-400 font-medium">Referral link active · </span>
              You were referred by{' '}
              <code className="px-1.5 py-0.5 rounded bg-zinc-900 font-mono text-xs">
                {code}
              </code>
              {referrer && (
                <span className="text-muted-foreground">
                  {' '}· {referrer.referredCount} other referees
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {wallet.address
                ? 'Bind your wallet to lock in a 4% fee discount on every trade.'
                : 'Connect your wallet, then bind the referral to lock in a 4% fee discount.'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={bind}
              disabled={busy || !wallet.address}
              size="sm"
            >
              {busy ? 'Binding…' : 'Bind referrer'}
            </Button>
            <Button variant="ghost" size="sm" onClick={dismiss} disabled={busy}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
