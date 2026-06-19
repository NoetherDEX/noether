'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { useWalletStore } from '@/lib/store';
import { claimReferralFees } from '@/lib/stellar/referral';
import { fmtReferralUsdc } from '@/types/referral';
import toast from 'react-hot-toast';

interface Props {
  claimable: string; // raw bigint string (PRECISION-scaled)
  onClaimed: () => void;
}

function humanize(raw: string): string {
  const s = raw || '';
  if (/Error\(Contract, #14\)/.test(s)) return 'Nothing to claim right now.';
  if (/Error\(Contract, #10\)/.test(s)) return 'No code registered for this address.';
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

export function ClaimFeesCard({ claimable, onClaimed }: Props) {
  const wallet = useWalletStore();
  const [busy, setBusy] = useState(false);

  const claimableBI = BigInt(claimable || '0');
  const hasClaim = claimableBI > 0n;

  async function claim() {
    if (!wallet.address) return toast.error('Connect a wallet first');
    if (!hasClaim) return toast.error('Nothing to claim');
    setBusy(true);
    try {
      await claimReferralFees(wallet.address);
      toast.success('Claim transaction submitted');
      onClaimed();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed: ${humanize(msg)}`);
    } finally {
      setBusy(false);
    }
  }

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
            <p className="mt-2 text-xs text-amber-400/90">
              Earnings accrual and on-chain claims go live in v1.1 — codes you
              register now carry over.
            </p>
          </div>
          <Button
            onClick={claim}
            disabled
            title="Referral earnings accrual and claims go live in v1.1"
          >
            Claims live in v1.1
          </Button>
        </div>
      </div>
    </div>
  );
}
