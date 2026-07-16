'use client';

import { useEffect, useState } from 'react';
import { Button, Input } from '@/components/ui';
import { useWalletStore } from '@/lib/store';
import { setReferrer } from '@/lib/stellar/referral';
import { clearPendingReferral, getPendingReferral } from '@/lib/referralCode';
import { toUserMessage } from '@/lib/utils/userError';
import toast from 'react-hot-toast';

const CODE_RE = /^[A-Za-z0-9_-]{3,16}$/;

interface Props {
  /** Fired with the bound code after a successful on-chain `set_referrer`. */
  onBound: (code: string) => void;
}

/**
 * Manual referral-code redemption ("Have a referral code?"). Covers codes
 * relayed verbally / outside a ?ref= link, and revives a parked code after
 * the invitation banner was dismissed (prefilled from localStorage).
 */
export function BindCodeCard({ onBound }: Props) {
  const wallet = useWalletStore();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  // Prefill with a pending/parked ?ref= code — dismissal parked it, not deleted it.
  useEffect(() => {
    const pending = getPendingReferral();
    if (pending) setCode(pending);
  }, []);

  const trimmed = code.trim();
  const valid = CODE_RE.test(trimmed);

  async function submit() {
    if (!wallet.address || !wallet.walletId) return toast.error('Connect a wallet first');
    if (!valid) return toast.error('Codes are 3–16 characters: letters, digits, _ or -');
    setBusy(true);
    try {
      await setReferrer(wallet.address, trimmed);
      clearPendingReferral();
      toast.success(`Referral code ${trimmed} bound on-chain`);
      setCode('');
      onBound(trimmed);
    } catch (err) {
      toast.error(toUserMessage(err, { contract: 'referral' }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="space-y-3">
        <h3 className="text-[13px] font-medium text-foreground">Have a referral code?</h3>
        <p className="text-xs text-faint">
          Enter a friend&apos;s code and accept the invite with one signed
          transaction — the binding is permanent, on-chain. Your 4% fee
          discount activates in v1.1. Codes are case-sensitive.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. noemerth"
            maxLength={16}
            spellCheck={false}
            autoComplete="off"
            className="h-9 font-mono"
            aria-label="Referral code"
          />
          <Button
            onClick={submit}
            variant="secondary"
            size="md"
            disabled={busy || !wallet.address || !valid}
          >
            {busy ? 'Signing…' : 'Bind code'}
          </Button>
        </div>
        {trimmed.length > 0 && !valid && (
          <p className="text-xs text-short flex items-center gap-1.5">
            <span aria-hidden className="w-1 h-1 rounded-full bg-short flex-none" />
            3–16 characters: letters, digits, _ or - only
          </p>
        )}
      </div>
    </div>
  );
}
