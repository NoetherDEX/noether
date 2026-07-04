'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { CreateCodeCard } from './CreateCodeCard';
import { ReferralStats } from './ReferralStats';
import { ShareLinkCard } from './ShareLinkCard';
import { ClaimFeesCard } from './ClaimFeesCard';
import { useWalletStore, useSessionAuthStore } from '@/lib/store';
import { exchangeChallenge, requestChallenge } from '@/lib/api/keys';
import { getReferralInfo } from '@/lib/api/referral';
import { signChallengeWithWallet } from '@/lib/api/sign';
import type { ReferrerRow, ReferralBindingRow } from '@/types/referral';
import toast from 'react-hot-toast';

/**
 * Public-by-default referral landing.
 *
 *  1. No wallet → connect prompt.
 *  2. Wallet present, no code on-chain → CreateCodeCard.
 *  3. Wallet present, code already registered → ShareLinkCard +
 *     ClaimFeesCard + ReferralStats. All read from the public
 *     /v1/referral/info endpoint — no API key needed.
 *  4. Optional "Advanced — full dashboard" collapsible. Sign-in
 *     unlocks trade-by-trade activity tables; 403 closed-beta cases
 *     surface as an inline amber notice instead of a toast error.
 */
export function ReferralSignIn() {
  const wallet = useWalletStore();
  const setAuth = useSessionAuthStore((s) => s.setAuth);
  const [self, setSelf] = useState<ReferrerRow | null>(null);
  const [binding, setBinding] = useState<ReferralBindingRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [betaBlocked, setBetaBlocked] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Load on-chain referral state whenever the wallet changes.
  useEffect(() => {
    if (!wallet.address) {
      setSelf(null);
      setBinding(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const data = await getReferralInfo(wallet.address!);
        if (cancelled) return;
        setSelf(data?.self ?? null);
        setBinding(data?.binding ?? null);
      } catch (err) {
        // 404 already swallowed inside getReferralInfo as null.
        // Network errors keep `self` null and we fall through to
        // the CreateCodeCard path — the on-chain register call will
        // surface any real failure.
        console.warn('[referral] info lookup failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet.address, refreshKey]);

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
        <div className="p-6">
          <p className="text-sm text-muted-foreground">
            Connect a Stellar wallet from the navbar to register a referral
            code. No sign-up needed — the code lives on-chain.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {loading && !self && (
        <div className="rounded-2xl border border-white/10 bg-card p-6 text-sm text-muted-foreground">
          Loading your referral state from chain…
        </div>
      )}

      {/* Has a registered code → show stats + share + claim */}
      {self && (
        <>
          <ReferralStats row={self} />
          <ClaimFeesCard claimable={self.claimable} onClaimed={refresh} />
          <ShareLinkCard code={self.code} />
        </>
      )}

      {/* No code yet → register form */}
      {!loading && !self && <CreateCodeCard onCreated={refresh} />}

      {/* Referee binding hint (you were referred by …) */}
      {binding && (
        <div className="rounded-2xl border border-white/10 bg-card p-5 text-xs text-muted-foreground">
          You were referred by code{' '}
          <code className="text-foreground font-mono">{binding.code}</code>{' '}
          on {new Date(binding.boundAt * 1000).toLocaleDateString()}.
        </div>
      )}

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
          <span className="text-xs text-muted-foreground">{showAdvanced ? '▲' : '▼'}</span>
        </button>

        {showAdvanced && (
          <div className="px-6 pb-6 pt-2 space-y-4 border-t border-white/5">
            <p className="text-sm text-muted-foreground">
              Sign a one-time challenge to unlock the analytics dashboard —
              trade-by-trade earnings, claim history, and aggregated stats.
              The code and share link above work without this.
            </p>

            {betaBlocked ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
                <p className="text-sm text-amber-300 font-medium">
                  Dashboard analytics — closed beta
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  The API gateway behind the dashboard is currently restricted
                  to early-access wallets while we tune rate limits and trade
                  simulation costs. Your code, share link, and claim flow work
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
