'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui';
import { fmtReferralUsdc } from '@/types/referral';
import { useWallet } from '@/lib/hooks/useWallet';
import {
  claimReferralFees,
  getReferralConfig,
  referralClaimsEnabled,
} from '@/lib/stellar/referral';
import { decodeContractError } from '@/lib/utils/contractErrors';

interface Props {
  claimable: string; // raw bigint string (PRECISION-scaled)
  onClaimed: () => void;
}

/**
 * L1-18 funded claims. The button enables ONLY when the deployed registry
 * is referral_v1 (the funded implementation) — the v0 claim() would zero
 * an earned balance without paying, so pre-Batch-1 the card keeps the
 * honest "opens at the next deploy" state.
 */
export function ClaimFeesCard({ claimable, onClaimed }: Props) {
  const { publicKey } = useWallet();
  const claimableBI = BigInt(claimable || '0');
  const hasClaim = claimableBI > 0n;

  const [claimsEnabled, setClaimsEnabled] = useState(false);
  const [economics, setEconomics] = useState<{ discountBps: number; shareBps: number } | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    referralClaimsEnabled()
      .then(async (enabled) => {
        if (cancelled) return;
        setClaimsEnabled(enabled);
        if (enabled) setEconomics(await getReferralConfig());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleClaim = async () => {
    if (!publicKey) return;
    setIsClaiming(true);
    const promise = claimReferralFees(publicKey);
    toast.promise(promise, {
      loading: 'Claiming referral earnings…',
      success: (paid) => {
        onClaimed();
        return `Claimed $${fmtReferralUsdc(paid.toString())} USDC`;
      },
      error: (err) =>
        decodeContractError(err, { contract: 'referral' }) || 'Claim failed — try again shortly',
    });
    try {
      await promise;
    } catch {
      // toast carries the message
    } finally {
      setIsClaiming(false);
    }
  };

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
              {claimsEnabled
                ? economics
                  ? `You earn ${economics.shareBps / 100}% of every referred trade's fee; your referees save ${economics.discountBps / 100}% — paid in USDC, claim any time.`
                  : 'Paid in USDC — claim any time.'
                : 'Fee accrual and payouts go live at the next contract deploy.'}
            </p>
          </div>
          {claimsEnabled ? (
            <Button
              size="md"
              onClick={handleClaim}
              disabled={!hasClaim || !publicKey || isClaiming}
              isLoading={isClaiming}
            >
              {isClaiming ? 'Claiming…' : 'Claim'}
            </Button>
          ) : (
            <Button variant="secondary" size="md" disabled>
              Claims open at the next deploy
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
