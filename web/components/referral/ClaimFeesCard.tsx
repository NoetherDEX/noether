'use client';

import { Button } from '@/components/ui';
import { fmtReferralUsdc } from '@/types/referral';

interface Props {
  claimable: string; // raw bigint string (PRECISION-scaled)
  onClaimed: () => void;
}

export function ClaimFeesCard({ claimable }: Props) {
  const claimableBI = BigInt(claimable || '0');
  const hasClaim = claimableBI > 0n;

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <h3 className="text-[13px] font-medium text-foreground">Claim earnings</h3>
      </div>
      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-faint">Claimable balance</p>
            <p
              className={`mt-1.5 text-lg font-medium font-mono tabular-nums ${
                hasClaim ? 'text-long' : 'text-foreground'
              }`}
            >
              ${fmtReferralUsdc(claimable)}
            </p>
            <p className="mt-1.5 text-[11px] text-faint">
              Fee accrual and payouts go live in v1.1.
            </p>
          </div>
          <Button variant="secondary" size="md" disabled>Claims open in v1.1</Button>
        </div>
      </div>
    </div>
  );
}
