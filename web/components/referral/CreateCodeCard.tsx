'use client';

import { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { useWalletStore } from '@/lib/store';
import { createReferralCode, lookupCode } from '@/lib/stellar/referral';
import toast from 'react-hot-toast';

const MIN = 3;
const MAX = 16;

/** Pretty-print common on-chain referral errors. */
function humanize(raw: string): string {
  const s = raw || '';
  if (/Error\(Contract, #6\)/.test(s)) return 'Code is too short (min 3 characters).';
  if (/Error\(Contract, #7\)/.test(s)) return 'Code is too long (max 16 characters).';
  if (/Error\(Contract, #8\)/.test(s)) return 'That code is already taken.';
  if (/Error\(Contract, #9\)/.test(s)) return 'You already have a code registered.';
  if (/Error\(Contract, #13\)/.test(s))
    return 'Insufficient trading volume — your 14-day volume must cross the threshold first.';
  if (/Error\(Contract, #5\)/.test(s)) return 'Invalid parameter.';
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

const VALID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Closed-beta allowlist for code creation. Reads
 * `NEXT_PUBLIC_REFERRAL_CREATOR_ALLOWLIST` (comma-separated Stellar
 * addresses) at build time. Empty/unset → anyone may try (contract
 * still enforces InsufficientVolume on-chain). Set → only wallets in
 * the list see the create form active.
 */
const ALLOWLIST = (() => {
  const raw = (process.env.NEXT_PUBLIC_REFERRAL_CREATOR_ALLOWLIST ?? '').trim();
  if (!raw) return null;
  return new Set(
    raw.split(',').map((s) => s.trim()).filter((s) => s.length === 56 && s.startsWith('G')),
  );
})();

interface Props {
  onCreated: () => void;
}

export function CreateCodeCard({ onCreated }: Props) {
  const wallet = useWalletStore();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<null | boolean>(null);
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
      const owner = await lookupCode(wallet.address, trimmed);
      setAvailable(owner === null);
    } catch {
      setAvailable(null);
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
      await createReferralCode(wallet.address, trimmed);
      toast.success(`Code "${trimmed}" registered on-chain`);
      setCode('');
      setAvailable(null);
      onCreated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed: ${humanize(msg)}`);
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
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
        <div className="px-6 py-4 border-b border-amber-500/20">
          <span className="text-[10px] uppercase tracking-[0.18em] text-amber-400 font-medium">
            Closed Beta · Early Access Only
          </span>
        </div>
        <div className="p-6 space-y-4">
          <h3 className="text-base font-semibold">Referral codes are invite-only right now</h3>
          <p className="text-sm text-muted-foreground">
            During the test phase we&apos;re hand-picking the first creators.
            You can still earn discounts as a referee — clicking somebody
            else&apos;s referral link binds you to them on-chain on your
            first authed call.
          </p>
          <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-4 text-xs space-y-1">
            <p className="text-muted-foreground">Your wallet</p>
            <code className="font-mono text-foreground break-all">{wallet.address}</code>
          </div>
          <p className="text-sm">
            Want a code?{' '}
            <a
              href="https://twitter.com/Noetherdex"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-400 hover:text-amber-300"
            >
              DM us on X
            </a>{' '}
            or{' '}
            <a
              href="https://discord.gg/2BxYv6Uc"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-400 hover:text-amber-300"
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
    <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
      <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-base font-semibold text-foreground">Register your referral code</h3>
        {gated && (
          <span className="text-[10px] uppercase tracking-[0.18em] text-amber-400 font-medium">
            Closed Beta
          </span>
        )}
      </div>

      <div className="p-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          Pick a unique short handle (3–16 characters, letters/digits/<code className="text-xs">_</code>/<code className="text-xs">-</code>).
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
              className="font-mono"
            />
            <div className="mt-2 text-xs flex items-center gap-3">
              <span
                className={
                  trimmed.length === 0
                    ? 'text-muted-foreground'
                    : lengthOk
                    ? 'text-[#22c55e]'
                    : 'text-red-400'
                }
              >
                {trimmed.length}/{MAX} chars
              </span>
              {trimmed.length > 0 && !charsOk && (
                <span className="text-red-400">
                  only letters / digits / _ / - allowed
                </span>
              )}
              {checking && <span className="text-muted-foreground">checking…</span>}
              {available === true && lengthOk && charsOk && (
                <span className="text-[#22c55e]">✓ available</span>
              )}
              {available === false && (
                <span className="text-red-400">already taken</span>
              )}
            </div>
          </div>
          <Button
            onClick={submit}
            disabled={busy || !wallet.address || !lengthOk || !charsOk || available === false}
          >
            {busy ? 'Signing…' : 'Register code'}
          </Button>
        </div>

        <div className="text-xs text-muted-foreground/80 border-t border-white/5 pt-3 leading-relaxed">
          <span className="text-foreground/70">Note:</span> the contract enforces a 14-day
          trading volume threshold before letting you register. If you haven&apos;t
          traded enough yet, the call will revert with <code className="text-[10px]">InsufficientVolume</code>.
        </div>
      </div>
    </div>
  );
}
