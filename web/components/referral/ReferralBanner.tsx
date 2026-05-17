'use client';

import { useEffect, useState } from 'react';
import { Button, Card, CardContent } from '@/components/ui';
import { captureReferralFromLocation, clearPendingReferral, getPendingReferral } from '@/lib/referralCode';
import { lookupReferralCode } from '@/lib/api/referral';
import type { ReferrerRow } from '@/types/referral';

/**
 * Sticky-at-top banner shown across the app while a `?ref=CODE` is
 * pending. Disappears once the user dismisses it or completes the
 * `set_referrer` transaction (which clears localStorage via
 * consumePendingReferral).
 */
export function ReferralBanner() {
  const [code, setCode] = useState<string | null>(null);
  const [referrer, setReferrer] = useState<ReferrerRow | null>(null);

  useEffect(() => {
    captureReferralFromLocation();
    const pending = getPendingReferral();
    if (!pending) return;
    setCode(pending);
    void lookupReferralCode(pending).then((row) => setReferrer(row));
  }, []);

  if (!code) return null;

  function dismiss() {
    clearPendingReferral();
    setCode(null);
  }

  return (
    <Card className="border-blue-500/40 bg-blue-500/10">
      <CardContent className="p-4 flex items-center justify-between gap-4">
        <div className="text-sm">
          <p>
            <span className="font-medium">You were referred by code </span>
            <code className="px-1.5 py-0.5 rounded bg-zinc-900 font-mono text-xs">{code}</code>
            {referrer && (
              <span className="text-zinc-400">
                {' '}
                · {referrer.referredCount} other referees
              </span>
            )}
          </p>
          <p className="text-xs text-zinc-400 mt-0.5">
            Connect your wallet and your first trade will bind this referral —
            you'll get a 4% fee discount automatically.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Dismiss
        </Button>
      </CardContent>
    </Card>
  );
}
