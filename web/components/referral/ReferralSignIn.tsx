'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { CreateCodeCard, makeOptimisticReferrerRow } from './CreateCodeCard';
import { BindCodeCard } from './BindCodeCard';
import { ReferralStats } from './ReferralStats';
import { ShareLinkCard } from './ShareLinkCard';
import { ClaimFeesCard } from './ClaimFeesCard';
import { useWalletStore, useSessionAuthStore } from '@/lib/store';
import { exchangeChallenge, requestChallenge } from '@/lib/api/keys';
import { getReferralInfo } from '@/lib/api/referral';
import { signChallengeWithWallet } from '@/lib/api/sign';
import { formatDate } from '@/lib/utils/format';
import { DISCORD_URL } from '@/lib/utils/constants';
import type { ReferrerRow, ReferralBindingRow } from '@/types/referral';
import { ApiError } from '@/lib/api/base';
import { toUserMessage } from '@/lib/utils/userError';
import toast from 'react-hot-toast';

/**
 * Public-by-default referral landing.
 *
 *  1. No wallet → connect prompt.
 *  2. Wallet present, no code on-chain → CreateCodeCard.
 *  3. Wallet present, code already registered → ShareLinkCard +
 *     ClaimFeesCard + ReferralStats. All read from the public
 *     /v1/referral/info endpoint — no API key needed.
 *     Wallets not yet referred also get a manual BindCodeCard.
 *  4. Optional "Advanced — full dashboard" collapsible. Sign-in
 *     unlocks trade-by-trade activity tables; 403 closed-beta cases
 *     surface as an inline amber notice instead of a toast error.
 */
export function ReferralSignIn() {
  const wallet = useWalletStore();
  const setAuth = useSessionAuthStore((s) => s.setAuth);
  const [self, setSelf] = useState<ReferrerRow | null>(null);
  const [binding, setBinding] = useState<ReferralBindingRow | null>(null);
  // Optimistic copies of just-confirmed on-chain writes: the indexer behind
  // getReferralInfo lags a confirmed tx by seconds, so an instant re-read
  // would show the register form again as if creation failed. These bridge
  // the gap until the indexer catches up (they never override real data).
  const [optimisticSelf, setOptimisticSelf] = useState<ReferrerRow | null>(null);
  const [optimisticBinding, setOptimisticBinding] = useState<ReferralBindingRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [betaBlocked, setBetaBlocked] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Optimistic state belongs to one wallet — drop it when the wallet changes.
  useEffect(() => {
    setOptimisticSelf(null);
    setOptimisticBinding(null);
  }, [wallet.address]);

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
      if (err instanceof ApiError && err.code === 'not_in_beta') {
        setBetaBlocked(true);
      } else {
        toast.error(`Sign-in failed: ${toUserMessage(err)}`);
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

  // Real indexer data wins; optimistic bridges the indexing lag.
  const shownSelf = self ?? optimisticSelf;
  const shownBinding = binding ?? optimisticBinding;

  return (
    <div className="space-y-4 md:space-y-6">
      {loading && !shownSelf && (
        <div className="rounded-2xl border border-white/10 bg-card p-6 text-sm text-muted-foreground">
          Loading your referral state from chain…
        </div>
      )}

      {/* Has a registered code → show stats + share + claim */}
      {shownSelf && (
        <>
          <ReferralStats row={shownSelf} />
          <ClaimFeesCard claimable={shownSelf.claimable} onClaimed={refresh} />
          <ShareLinkCard code={shownSelf.code} />
        </>
      )}

      {/* No code yet → register form */}
      {!loading && !shownSelf && (
        <CreateCodeCard
          onCreated={(newCode) => {
            setOptimisticSelf(makeOptimisticReferrerRow(wallet.address ?? '', newCode));
            // Re-read once after the indexer has certainly caught up,
            // instead of instantly (and near-certainly) missing.
            window.setTimeout(refresh, 30_000);
          }}
        />
      )}

      {/* Not referred yet → manual code redemption (covers dismissed banner) */}
      {!loading && !shownBinding && (
        <BindCodeCard
          onBound={(boundCode) => {
            setOptimisticBinding({
              referee: wallet.address ?? '',
              referrer: '',
              code: boundCode,
              boundAt: Math.floor(Date.now() / 1000),
              txHash: '',
            });
            window.setTimeout(refresh, 30_000);
          }}
        />
      )}

      {/* Referee binding hint (you were referred by …) */}
      {shownBinding && (
        <div className="rounded-2xl border border-white/10 bg-card p-5 text-xs text-muted-foreground">
          You were referred by code{' '}
          <code className="text-foreground font-mono">{shownBinding.code}</code>{' '}
          on {formatDate(shownBinding.boundAt)}.
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
                    href={DISCORD_URL}
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
