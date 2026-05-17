'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { useWalletStore, useSessionAuthStore } from '@/lib/store';
import { exchangeChallenge, requestChallenge } from '@/lib/api/keys';
import { signChallengeWithWallet } from '@/lib/api/sign';
import toast from 'react-hot-toast';

export function ReferralSignIn() {
  const wallet = useWalletStore();
  const setAuth = useSessionAuthStore((s) => s.setAuth);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    if (!wallet.address) return toast.error('Connect a wallet first');
    setBusy(true);
    try {
      const challenge = await requestChallenge(wallet.address);
      const signedXdr = await signChallengeWithWallet(challenge.challengeHex, wallet.address);
      const key = await exchangeChallenge({
        address: wallet.address,
        challenge: challenge.challengeHex,
        signatureHex: signedXdr,
        label: 'referral-dashboard',
      });
      setAuth({ keyId: key.keyId, secret: key.secret, owner: key.owner });
      toast.success('Signed in');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Sign-in failed: ${msg.slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
      <div className="px-6 py-4 border-b border-white/10">
        <h3 className="text-base font-semibold text-foreground">Sign in to view your dashboard</h3>
      </div>
      <div className="p-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          Sign a one-time challenge with your wallet to load your live earnings,
          claimable balance, and share link. The session lasts until you close
          the tab — secrets stay in memory and never leave your browser.
        </p>
        <Button onClick={signIn} disabled={busy || !wallet.address}>
          {busy
            ? 'Signing challenge…'
            : wallet.address
            ? 'Sign in with wallet'
            : 'Connect wallet first'}
        </Button>
      </div>
    </div>
  );
}
