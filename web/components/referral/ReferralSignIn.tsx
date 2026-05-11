'use client';

import { useState } from 'react';
import { Button, Card, CardContent } from '@/components/ui';
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
      const signatureHex = await signChallengeWithWallet(challenge.challengeHex, wallet.address);
      const key = await exchangeChallenge({
        address: wallet.address,
        challenge: challenge.challengeHex,
        signatureHex,
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
    <Card>
      <CardContent className="p-6 space-y-3">
        <h2 className="font-medium">Sign in to view your referral dashboard</h2>
        <p className="text-sm text-zinc-400">
          Sign a one-time challenge with your wallet to load your live earnings,
          claimable balance, and share link. The session lasts until you close
          the tab — secrets stay in memory.
        </p>
        <Button onClick={signIn} disabled={busy || !wallet.address}>
          {busy ? 'Signing challenge…' : wallet.address ? 'Sign in with wallet' : 'Connect wallet first'}
        </Button>
      </CardContent>
    </Card>
  );
}
