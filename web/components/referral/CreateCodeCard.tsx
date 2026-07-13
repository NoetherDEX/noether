'use client';

import { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { cn } from '@/lib/utils/cn';
import { useWalletStore } from '@/lib/store';
import { createReferralCode, lookupCode, type CodeAvailability } from '@/lib/stellar/referral';
import { DISCORD_URL } from '@/lib/utils/constants';
import type { ReferrerRow } from '@/types/referral';
import { toUserMessage } from '@/lib/utils/userError';
import toast from 'react-hot-toast';

const MIN = 3;
const MAX = 16;

/**
 * Zeroed ReferrerRow for a just-registered code. The indexer that backs
 * `getReferralInfo` is eventually consistent (~2s poll + ledger close), so an
 * instant re-read after `create_code` almost always misses — render this
 * optimistically instead. All-zero money fields are truthful for a brand-new
 * code.
 */
export function makeOptimisticReferrerRow(address: string, code: string): ReferrerRow {
  const now = Math.floor(Date.now() / 1000);
  return {
    referrer: address,
    code,
    createdAt: now,
    referredCount: 0,
    totalVolumeGenerated: '0',
    totalEarned: '0',
    claimable: '0',
    updatedAt: now,
  };
}

const VALID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Closed-beta allowlist for code creation. Reads
 * `NEXT_PUBLIC_REFERRAL_CREATOR_ALLOWLIST` (comma-separated Stellar
 * addresses) at build time. Eligibility is client-side only — the
 * contract does not enforce a volume threshold. Empty/unset → anyone
 * may try. Set → only wallets in the list see the create form active.
 */
const ALLOWLIST = (() => {
  const raw = (process.env.NEXT_PUBLIC_REFERRAL_CREATOR_ALLOWLIST ?? '').trim();
  if (!raw) return null;
  return new Set(
    raw.split(',').map((s) => s.trim()).filter((s) => s.length === 56 && s.startsWith('G')),
  );
})();

interface Props {
  /** Fired with the registered code after `create_code` confirms on-chain. */
  onCreated: (code: string) => void;
}

export function CreateCodeCard({ onCreated }: Props) {
  const wallet = useWalletStore();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<CodeAvailability | null>(null);
  const [checking, setChecking] = useState(false);

  const gated = ALLOWLIST !== null;
  const allowed = !gated || (wallet.address ? ALLOWLIST!.has(wallet.address) : false);

  async function check() {
    if (!wallet.address) return;
    const trimmed = code.trim();
    if (trimmed.length < MIN || trimmed.length > MAX || !VALID_RE.test(trimmed)) {
      setAvailable(null);
      return;
    }
    setChecking(true);
    try {
      setAvailable(await lookupCode(wallet.address, trimmed));
    } finally {
      setChecking(false);
    }
  }

  async function submit() {
    const trimmed = code.trim();
    if (!wallet.address || !wallet.walletId) return toast.error('Connect a wallet first');
    if (trimmed.length < MIN) return toast.error(`Code must be at least ${MIN} characters`);
    if (trimmed.length > MAX) return toast.error(`Code must be at most ${MAX} characters`);
    if (!VALID_RE.test(trimmed)) return toast.error('Only letters, digits, _ and - allowed');

    setBusy(true);
    try {
      const availability = await lookupCode(wallet.address, trimmed);
      setAvailable(availability);
      if (availability === 'taken') {
        toast.error(`"${trimmed}" is already taken — pick another code.`);
        return;
      }
      await createReferralCode(wallet.address, trimmed);
      toast.success(`Code "${trimmed}" registered on-chain`);
      setCode('');
      setAvailable(null);
      onCreated(trimmed);
    } catch (err) {
      console.error('[referral] register failed', err);
      toast.error(`Failed: ${toUserMessage(err, { contract: 'referral' })}`);
    } finally {
      setBusy(false);
    }
  }

  const trimmed = code.trim();
  const lengthOk = trimmed.length >= MIN && trimmed.length <= MAX;
  const charsOk = !trimmed || VALID_RE.test(trimmed);

  // Gated state: allowlist configured + wallet connected + not on list.
  if (gated && wallet.address && !allowed) {
    return (
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-[13px] font-medium text-foreground">
            Referral codes are invite-only right now
          </h3>
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
            Closed Beta · Early Access Only
          </span>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-muted-foreground">
            During the test phase we&apos;re hand-picking the first creators.
            You can still bind as a referee — open somebody&apos;s referral
            link (or enter their code below) and accept the invite with one
            signed transaction. Referee fee discounts activate in v1.1.
          </p>
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-faint">Your wallet</p>
            <code className="font-mono text-foreground break-all">{wallet.address}</code>
          </div>
          <p className="text-xs text-muted-foreground">
            Want a code?{' '}
            <a
              href="https://twitter.com/Noetherdex"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:opacity-80"
            >
              DM us on X
            </a>{' '}
            or{' '}
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:opacity-80"
            >
              join our Discord
            </a>{' '}
            with your address.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-[13px] font-medium text-foreground">Register your referral code</h3>
        {gated && (
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
            Closed Beta
          </span>
        )}
      </div>

      <div className="p-5 space-y-3">
        <p className="text-xs text-faint">
          Pick a unique short handle (3–16 characters, letters/digits/<code>_</code>/<code>-</code>).
          You sign the transaction with your wallet and the code lands on-chain
          permanently bound to your address.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
          <div>
            <Input
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setAvailable(null);
              }}
              onBlur={check}
              placeholder="e.g. noemerth"
              maxLength={MAX}
              spellCheck={false}
              autoComplete="off"
              className="h-9 font-mono"
            />
            <div className="mt-2 text-xs flex items-center gap-3">
              <span
                className={cn(
                  'font-mono tabular-nums',
                  trimmed.length === 0
                    ? 'text-muted-foreground'
                    : lengthOk
                    ? 'text-long'
                    : 'text-short'
                )}
              >
                {trimmed.length}/{MAX} chars
              </span>
              {trimmed.length > 0 && !charsOk && (
                <span className="text-short">
                  only letters / digits / _ / - allowed
                </span>
              )}
              {checking && <span className="text-muted-foreground">checking…</span>}
              {!checking && available === 'free' && lengthOk && charsOk && (
                <span className="text-long">✓ available</span>
              )}
              {!checking && available === 'taken' && (
                <span className="text-short">already taken</span>
              )}
              {!checking && available === 'unknown' && lengthOk && charsOk && (
                <span className="text-primary">couldn&apos;t verify availability</span>
              )}
            </div>
          </div>
          <Button
            onClick={submit}
            size="md"
            disabled={busy || !wallet.address || !lengthOk || !charsOk || available === 'taken'}
          >
            {busy ? 'Signing…' : 'Register code'}
          </Button>
        </div>

        <div className="text-xs text-faint border-t border-border pt-3 leading-relaxed">
          <span className="text-muted-foreground">On-chain:</span> the code lives in the referral
          contract — anyone with your wallet&apos;s Stellar address can verify
          ownership at any time. One wallet can register one code.
        </div>
      </div>
    </div>
  );
}
