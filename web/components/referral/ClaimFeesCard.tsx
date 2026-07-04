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
    <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
      <div className="px-6 py-4 border-b border-white/10">
        <h3 className="text-base font-semibold text-foreground">Claim earnings</h3>
      </div>
      <div className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs md:text-sm text-muted-foreground">Claimable balance</p>
            <p
              className={`mt-2 text-2xl md:text-3xl font-bold font-mono ${
                hasClaim ? 'text-[#22c55e]' : 'text-foreground'
              }`}
            >
              ${fmtReferralUsdc(claimable)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Fee accrual and payouts go live in v1.1.
            </p>
          </div>
          <Button disabled>Claims open in v1.1</Button>
        </div>
      </div>
    </div>
  );
}
