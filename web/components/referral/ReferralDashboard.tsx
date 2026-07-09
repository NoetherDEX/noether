'use client';

import { useCallback, useEffect, useState } from 'react';
import { ReferralStats } from './ReferralStats';
import { ShareLinkCard } from './ShareLinkCard';
import { ReferralTradesTable, ReferralClaimsTable } from './ReferralActivity';
import { CreateCodeCard, makeOptimisticReferrerRow } from './CreateCodeCard';
import { ClaimFeesCard } from './ClaimFeesCard';
import { useSessionAuthStore } from '@/lib/store';
import {
  getReferralMe,
  getReferralTrades,
  getReferralClaims,
} from '@/lib/api/referral';
import { formatDate } from '@/lib/utils/format';
import { toUserMessage } from '@/lib/utils/userError';
import type {
  ReferrerRow,
  ReferralTradeRow,
  ReferralClaimRow,
  ReferralBindingRow,
} from '@/types/referral';

interface DashboardState {
  loading: boolean;
  error: string | null;
  self: ReferrerRow | null;
  binding: ReferralBindingRow | null;
  trades: ReferralTradeRow[];
  claims: ReferralClaimRow[];
}

const INITIAL: DashboardState = {
  loading: true,
  error: null,
  self: null,
  binding: null,
  trades: [],
  claims: [],
};

export function ReferralDashboard() {
  const auth = useSessionAuthStore();
  const clearAuth = useSessionAuthStore((s) => s.clearAuth);
  const [state, setState] = useState<DashboardState>(INITIAL);
  // Bridges the indexer lag after create_code — see ReferralSignIn.
  const [optimisticSelf, setOptimisticSelf] = useState<ReferrerRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!auth.keyId || !auth.secret) return;
    const creds = { keyId: auth.keyId, secret: auth.secret };

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    (async () => {
      try {
        const me = await getReferralMe(creds);
        if (cancelled) return;

        const [trades, claims] = me.self
          ? await Promise.all([
              getReferralTrades(creds, 25).catch(() => []),
              getReferralClaims(creds, 25).catch(() => []),
            ])
          : [[], []];

        if (cancelled) return;
        setState({
          loading: false,
          error: null,
          self: me.self,
          binding: me.binding,
          trades,
          claims,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          ...INITIAL,
          loading: false,
          error: toUserMessage(err),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.keyId, auth.secret, refreshKey]);

  // Real indexer data wins; optimistic bridges the indexing lag.
  const self = state.self ?? optimisticSelf;

  if (state.loading && !self) {
    return (
      <div className="rounded-2xl border border-white/10 bg-card p-8 text-center text-sm text-muted-foreground">
        Loading dashboard…
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-card p-6 space-y-3">
        <p className="text-sm text-red-400">Could not load dashboard: {state.error}</p>
        <button
          type="button"
          onClick={clearAuth}
          className="text-xs underline text-muted-foreground hover:text-foreground"
        >
          Sign out and retry
        </button>
      </div>
    );
  }

  if (!self) {
    return (
      <div className="space-y-6">
        <CreateCodeCard
          onCreated={(newCode) => {
            if (auth.owner) setOptimisticSelf(makeOptimisticReferrerRow(auth.owner, newCode));
            // Re-read once the eventually-consistent indexer has caught up.
            window.setTimeout(refresh, 30_000);
          }}
        />

        {state.binding && (
          <div className="rounded-2xl border border-white/10 bg-card p-5 text-xs text-muted-foreground">
            You were referred by code{' '}
            <code className="text-foreground font-mono">{state.binding.code}</code>{' '}
            on {formatDate(state.binding.boundAt)}.
          </div>
        )}

        <div className="text-right">
          <button
            type="button"
            onClick={clearAuth}
            className="text-xs underline text-muted-foreground hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <ReferralStats row={self} />
      <ClaimFeesCard claimable={self.claimable} onClaimed={refresh} />
      <ShareLinkCard code={self.code} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <ReferralTradesTable rows={state.trades} />
        <ReferralClaimsTable rows={state.claims} />
      </div>
      <div className="text-right">
        <button
          type="button"
          onClick={clearAuth}
          className="text-xs underline text-muted-foreground hover:text-foreground"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

export function ReferralDashboardOrSignIn({ signInSlot }: { signInSlot: React.ReactNode }) {
  const keyId = useSessionAuthStore((s) => s.keyId);
  if (!keyId) return <>{signInSlot}</>;
  return <ReferralDashboard />;
}
