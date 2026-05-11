'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui';
import { ReferralStats } from './ReferralStats';
import { ShareLinkCard } from './ShareLinkCard';
import { ReferralTradesTable, ReferralClaimsTable } from './ReferralActivity';
import { useSessionAuthStore } from '@/lib/store';
import {
  getReferralMe,
  getReferralTrades,
  getReferralClaims,
} from '@/lib/api/referral';
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

  useEffect(() => {
    if (!auth.keyId || !auth.secret) return;
    const creds = { keyId: auth.keyId, secret: auth.secret };

    let cancelled = false;
    setState(INITIAL);

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
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.keyId, auth.secret]);

  if (state.loading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-zinc-400">Loading dashboard…</CardContent>
      </Card>
    );
  }

  if (state.error) {
    return (
      <Card className="border-red-500/30">
        <CardContent className="p-6 text-sm space-y-3">
          <p className="text-red-400">Could not load dashboard: {state.error}</p>
          <button
            type="button"
            onClick={clearAuth}
            className="text-xs underline text-zinc-400 hover:text-zinc-200"
          >
            Sign out and retry
          </button>
        </CardContent>
      </Card>
    );
  }

  if (!state.self) {
    return (
      <Card>
        <CardContent className="p-6 text-sm space-y-3">
          <h3 className="font-medium">No code registered yet</h3>
          <p className="text-zinc-400">
            You're signed in but haven't registered a referral code. Once your
            14-day trading volume crosses the threshold, you can call
            {' '}
            <code className="text-xs">register_code</code> on the referral
            contract through the SDK or your wallet. Your dashboard appears here
            as soon as the code lands on-chain.
          </p>
          {state.binding && (
            <p className="text-xs text-zinc-500">
              You were referred by code <code className="text-zinc-300">{state.binding.code}</code>.
            </p>
          )}
          <button
            type="button"
            onClick={clearAuth}
            className="text-xs underline text-zinc-400 hover:text-zinc-200"
          >
            Sign out
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <ReferralStats row={state.self} />
      <ShareLinkCard code={state.self.code} />
      <ReferralTradesTable rows={state.trades} />
      <ReferralClaimsTable rows={state.claims} />
      <div className="text-right">
        <button
          type="button"
          onClick={clearAuth}
          className="text-xs underline text-zinc-500 hover:text-zinc-300"
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
