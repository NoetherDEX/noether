'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { CreateCodeCard } from './CreateCodeCard';
import { useWalletStore, useSessionAuthStore } from '@/lib/store';
import { exchangeChallenge, requestChallenge } from '@/lib/api/keys';
import { signChallengeWithWallet } from '@/lib/api/sign';
import toast from 'react-hot-toast';

/**
 * Public-by-default landing for /referrals.
 *
 *  - No wallet → connect prompt.
 *  - Wallet only → inline CreateCodeCard (purely contract-direct, no
 *    API auth needed). User can register a code, share it, claim
 *    earnings.
 *  - Optional "advanced" panel underneath: sign in (API key issuance)
 *    to unlock the trade-history / activity-table dashboard. Cleanly
 *    surfaces the 403 not_in_beta case as a friendly notice instead
 *    of a toast error.
 */
export function ReferralSignIn() {
  const wallet = useWalletStore();
  const setAuth = useSessionAuthStore((s) => s.setAuth);
  const [busy, setBusy] = useState(false);
  const [betaBlocked, setBetaBlocked] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  async function signIn() {
    if (!wallet.address) return toast.error('Connect a wallet first');
    setBusy(true);
    setBetaBlocked(false);
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
      if (/403/.test(msg) && /not_in_beta|not in beta/i.test(msg)) {
        setBetaBlocked(true);
      } else {
        toast.error(`Sign-in failed: ${msg.slice(0, 200)}`);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!wallet.address) {
    return (
      <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10">
          <h3 className="text-base font-semibold text-foreground">Connect your wallet</h3>
        </div>
        <div className="p-6 space-y-3">
          <p className="text-sm text-muted-foreground">
            Connect a Stellar wallet from the navbar to register a referral
            code and start earning. No sign-up needed — the code lives on-chain.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Primary path — always available */}
      <CreateCodeCard onCreated={() => { /* parent reloads via SWR/router refresh */ }} />

      {/* Advanced — optional API dashboard */}
      <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-white/[0.02] transition-colors"
        >
          <span className="text-base font-semibold text-foreground">
            Advanced — full dashboard
          </span>
          <span className="text-xs text-muted-foreground">
            {showAdvanced ? '▲' : '▼'}
          </span>
        </button>

        {showAdvanced && (
          <div className="px-6 pb-6 pt-2 space-y-4 border-t border-white/5">
            <p className="text-sm text-muted-foreground">
              Sign a one-time challenge to unlock the analytics dashboard —
              trade-by-trade earnings, claim history, and aggregated stats.
              Code registration above works without this.
            </p>

            {betaBlocked ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
                <p className="text-sm text-amber-300 font-medium">
                  Dashboard analytics — closed beta
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  The API gateway behind the dashboard is currently restricted
                  to early-access wallets while we tune rate limits and trade
                  simulation costs. Your code registration + share link work
                  fine without it.
                </p>
                <p className="text-xs">
                  Want in?{' '}
                  <a
                    href="https://twitter.com/Noetherdex"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber-400 hover:text-amber-300"
                  >
                    DM us on X
                  </a>{' '}
                  or{' '}
                  <a
                    href="https://discord.gg/2BxYv6Uc"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber-400 hover:text-amber-300"
                  >
                    join our Discord
                  </a>{' '}
                  with your address.
                </p>
              </div>
            ) : (
              <Button onClick={signIn} disabled={busy} size="sm">
                {busy ? 'Signing challenge…' : 'Sign in for analytics'}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
