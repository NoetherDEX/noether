'use client';

import { useState } from 'react';
import { Button, Card, CardContent, Input } from '@/components/ui';
import { useWalletStore } from '@/lib/store';
import { exchangeChallenge, requestChallenge } from '@/lib/api/keys';
import type { IssuedApiKey } from '@/lib/api/keys';
import { signChallengeWithWallet } from '@/lib/api/sign';
import toast from 'react-hot-toast';

const API_BASE = process.env.NEXT_PUBLIC_NOETHER_API_URL ?? 'http://localhost:4000';

export function ApiKeyIssueCard({ onIssued }: { onIssued?: (key: IssuedApiKey) => void }) {
  const wallet = useWalletStore();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<IssuedApiKey | null>(null);

  async function issue() {
    if (!wallet.address) return toast.error('Connect a wallet first');
    setBusy(true);
    try {
      const challenge = await requestChallenge(wallet.address);
      const signatureHex = await signChallengeWithWallet(challenge.challengeHex, wallet.address);
      const key = await exchangeChallenge({
        address: wallet.address,
        challenge: challenge.challengeHex,
        signatureHex,
        label: label || undefined,
      });
      setIssued(key);
      onIssued?.(key);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed: ${msg.slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  }

  if (issued) {
    return (
      <Card className="border-emerald-500/40 bg-emerald-500/5">
        <CardContent className="p-5 space-y-3">
          <h3 className="font-medium text-emerald-300">API key issued</h3>
          <p className="text-xs text-zinc-400">
            Store the secret immediately — it cannot be retrieved again. The
            gateway only keeps a SHA-256 hash.
          </p>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">Key id</label>
            <code className="block px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-xs font-mono break-all">
              {issued.keyId}
            </code>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">Secret</label>
            <code className="block px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-xs font-mono break-all">
              {issued.secret}
            </code>
          </div>
          <p className="text-xs text-zinc-500">
            Use these against {API_BASE} with header{' '}
            <code className="text-xs">Authorization: Bearer {issued.keyId}:{'<secret>'}</code>.
          </p>
          <Button variant="ghost" size="sm" onClick={() => setIssued(null)}>
            Dismiss
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <h3 className="font-medium">Issue a new API key</h3>
        <p className="text-sm text-zinc-400">
          Sign a one-time challenge with your wallet and the gateway hands
          back a key + secret. The secret is shown once — copy it now.
        </p>
        <div className="space-y-1">
          <label className="text-xs text-zinc-500 uppercase tracking-wider">
            Label (optional)
          </label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="grid-bot, mm-prod, …"
            maxLength={64}
          />
        </div>
        <Button onClick={issue} disabled={busy || !wallet.address} className="w-full">
          {busy ? 'Signing challenge…' : 'Issue key'}
        </Button>
        {!wallet.address && (
          <p className="text-xs text-amber-400">Connect a wallet first.</p>
        )}
      </CardContent>
    </Card>
  );
}
