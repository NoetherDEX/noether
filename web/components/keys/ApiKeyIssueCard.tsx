'use client';

import { useEffect, useState } from 'react';
import { Button, Input } from '@/components/ui';
import { useWalletStore } from '@/lib/store';
import {
  exchangeChallenge,
  getBetaStatus,
  requestChallenge,
} from '@/lib/api/keys';
import type { BetaStatus, IssuedApiKey } from '@/lib/api/keys';
import { signChallengeWithWallet } from '@/lib/api/sign';
import { apiBaseOrNull } from '@/lib/api/base';
import { DISCORD_URL } from '@/lib/utils/constants';
import { toUserMessage } from '@/lib/utils/userError';
import toast from 'react-hot-toast';

type CopyKind = 'keyId' | 'secret' | 'header';

// One-time credential display: value + a copy button with copied feedback.
function CopyableField({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <div className="flex items-start gap-2">
        <code className="flex-1 block px-4 py-3 bg-zinc-900/60 border border-white/10 rounded-xl text-xs font-mono break-all">
          {value}
        </code>
        <Button variant="ghost" size="sm" onClick={onCopy} className="flex-none">
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

export function ApiKeyIssueCard({ onIssued }: { onIssued?: (key: IssuedApiKey) => void }) {
  const wallet = useWalletStore();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<IssuedApiKey | null>(null);
  const [beta, setBeta] = useState<BetaStatus | null>(null);
  const [betaErr, setBetaErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyKind | null>(null);
  const [ackStored, setAckStored] = useState(false);

  async function copyValue(text: string, kind: CopyKind) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied((prev) => (prev === kind ? null : prev)), 2000);
    } catch {
      toast.error('Clipboard unavailable — select the text and copy manually.');
    }
  }

  useEffect(() => {
    let cancelled = false;
    setBeta(null);
    setBetaErr(null);
    (async () => {
      try {
        const s = await getBetaStatus(wallet.address ?? undefined);
        if (!cancelled) setBeta(s);
      } catch (err) {
        if (!cancelled) setBetaErr(toUserMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet.address]);

  const gated = beta?.gated ?? false;
  const allowed = !gated || (beta?.allowed ?? false);

  async function issue() {
    if (!wallet.address) return toast.error('Connect a wallet first');
    if (gated && !allowed) {
      return toast.error(
        'Your wallet is not on the early-access list yet. DM us on X or join Discord to request access.',
      );
    }
    setBusy(true);
    try {
      const challenge = await requestChallenge(wallet.address);
      const signedXdr = await signChallengeWithWallet(challenge.challengeHex, wallet.address);
      const key = await exchangeChallenge({
        address: wallet.address,
        challenge: challenge.challengeHex,
        signatureHex: signedXdr,
        label: label || undefined,
      });
      setIssued(key);
      setAckStored(false);
      setCopied(null);
      onIssued?.(key);
    } catch (err) {
      toast.error(`Failed: ${toUserMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  if (issued) {
    const authHeader = `Authorization: Bearer ${issued.keyId}:${issued.secret}`;
    const apiBase = apiBaseOrNull();
    return (
      <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 overflow-hidden">
        <div className="px-6 py-4 border-b border-emerald-500/20">
          <h3 className="text-base font-semibold text-emerald-300">API key issued</h3>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-xs text-muted-foreground">
            Store the secret immediately — it cannot be retrieved again. The
            gateway only keeps a SHA-256 hash.
          </p>
          <CopyableField
            label="Key id"
            value={issued.keyId}
            copied={copied === 'keyId'}
            onCopy={() => copyValue(issued.keyId, 'keyId')}
          />
          <CopyableField
            label="Secret"
            value={issued.secret}
            copied={copied === 'secret'}
            onCopy={() => copyValue(issued.secret, 'secret')}
          />
          <CopyableField
            label="Authorization header"
            value={authHeader}
            copied={copied === 'header'}
            onCopy={() => copyValue(authHeader, 'header')}
          />
          {apiBase && (
            <p className="text-xs text-muted-foreground">
              Use against{' '}
              <code className="text-xs px-1 py-0.5 rounded bg-zinc-900">{apiBase}</code>
            </p>
          )}
          <div className="pt-2 space-y-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={ackStored}
                onChange={(e) => setAckStored(e.target.checked)}
                className="accent-[#eab308]"
              />
              I have stored the secret
            </label>
            <Button
              variant="ghost"
              size="sm"
              disabled={!ackStored}
              onClick={() => setIssued(null)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Gated state — wallet exists but not on allowlist
  if (gated && wallet.address && beta && !beta.allowed) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
        <div className="px-6 py-4 border-b border-amber-500/20 flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-[0.18em] text-amber-400 font-medium">
            Closed Beta · Early Access Only
          </span>
        </div>
        <div className="p-6 space-y-4">
          <h3 className="text-base font-semibold">Your wallet is not on the allowlist yet</h3>
          <p className="text-sm text-muted-foreground">
            API key issuance is currently restricted to early-access wallets
            while we tune rate limits, fee tiers, and trade simulation costs.
            You can still browse markets, vaults, and the live event feed —
            only programmatic auth is gated.
          </p>
          <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-4 text-xs space-y-1">
            <p className="text-muted-foreground">Your wallet</p>
            <code className="font-mono text-foreground break-all">{wallet.address}</code>
          </div>
          <p className="text-sm">
            Want in?{' '}
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
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-400 hover:text-amber-300"
            >
              join our Discord
            </a>{' '}
            with your address and we&apos;ll whitelist you within 24h.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
      <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-base font-semibold text-foreground">Issue a new API key</h3>
        {gated && (
          <span className="text-[10px] uppercase tracking-[0.18em] text-amber-400 font-medium">
            Closed Beta
          </span>
        )}
      </div>
      <div className="p-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          Sign a one-time challenge with your wallet and the gateway hands
          back a key + secret. The secret is shown once — copy it now.
        </p>
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wider text-muted-foreground">
            Label (optional)
          </label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="grid-bot, mm-prod, …"
            maxLength={64}
          />
        </div>
        <Button
          onClick={issue}
          disabled={busy || !wallet.address || (gated && !allowed)}
          className="w-full"
        >
          {busy ? 'Signing challenge…' : 'Issue key'}
        </Button>
        {!wallet.address && (
          <p className="text-xs text-amber-400">Connect a wallet first.</p>
        )}
        {betaErr && (
          <p className="text-xs text-red-400">
            Could not reach the gateway to check beta status. ({betaErr})
          </p>
        )}
      </div>
    </div>
  );
}
