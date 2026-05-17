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

interface Props {
  onCreated: () => void;
}

export function CreateCodeCard({ onCreated }: Props) {
  const wallet = useWalletStore();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<null | boolean>(null);
  const [checking, setChecking] = useState(false);

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

  return (
    <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
      <div className="px-6 py-4 border-b border-white/10">
        <h3 className="text-base font-semibold text-foreground">Register your referral code</h3>
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
              placeholder="e.g. mertcicek"
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
