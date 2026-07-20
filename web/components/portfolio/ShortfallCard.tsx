'use client';

/**
 * L0-3 shortfall claim card: renders ONLY when the gateway confirms this
 * wallet is owed USDC the vault couldn't pay in full at settlement. The
 * claim is reserve-first, never pause-gated; partial payments leave the
 * remainder claimable, so the card refetches after every claim.
 */

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { fetchAccountShortfall, type AccountShortfall } from '@/lib/api/shortfall';
import { claimShortfall } from '@/lib/stellar/shortfall';
import { fromPrecision } from '@/lib/utils/format';
import { Button } from '@/components/ui';
import { decodeContractError } from '@/lib/utils/contractErrors';

export function ShortfallCard({
  publicKey,
  sign,
  onClaimed,
}: {
  publicKey: string;
  sign: (xdr: string) => Promise<string>;
  onClaimed?: () => void;
}) {
  const [shortfall, setShortfall] = useState<AccountShortfall | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);

  const refresh = useCallback(async () => {
    setShortfall(await fetchAccountShortfall(publicKey));
  }, [publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!shortfall?.supported || shortfall.owed <= 0n) return null;

  const owedUsd = fromPrecision(shortfall.owed);
  const reserveUsd = fromPrecision(shortfall.reserve);

  const handleClaim = async () => {
    setIsClaiming(true);
    const promise = claimShortfall(publicKey, sign);
    toast.promise(promise, {
      loading: 'Claiming owed USDC…',
      success: (paid) => {
        void refresh();
        onClaimed?.();
        return `Claimed ${fromPrecision(paid).toFixed(2)} USDC${
          fromPrecision(paid) < owedUsd ? ' — remainder stays claimable as the reserve refills' : ''
        }`;
      },
      error: (err) => decodeContractError(err) || 'Claim failed — try again shortly',
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
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-medium text-foreground">Owed to you</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            A past payout could not be covered in full — the vault owes you{' '}
            <span className="font-mono text-foreground">${owedUsd.toFixed(2)}</span>. Repayment
            reserve currently holds{' '}
            <span className="font-mono text-foreground">${reserveUsd.toFixed(2)}</span>; claims pay
            up to what is available and the rest stays owed.
          </p>
        </div>
        <Button onClick={handleClaim} disabled={isClaiming} isLoading={isClaiming}>
          {isClaiming ? 'Claiming…' : 'Claim'}
        </Button>
      </div>
    </div>
  );
}
