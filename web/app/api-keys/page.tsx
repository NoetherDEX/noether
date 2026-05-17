'use client';

import { useState } from 'react';
import { Header } from '@/components/layout';
import { ApiKeyIssueCard } from '@/components/keys/ApiKeyIssueCard';
import { ApiKeysList } from '@/components/keys/ApiKeysList';
import { useSessionAuthStore } from '@/lib/store';
import type { IssuedApiKey } from '@/lib/api/keys';

export default function ApiKeysPage() {
  const setAuth = useSessionAuthStore((s) => s.setAuth);
  const [lastIssued, setLastIssued] = useState<IssuedApiKey | null>(null);

  function onIssued(key: IssuedApiKey) {
    setLastIssued(key);
    setAuth({ keyId: key.keyId, secret: key.secret, owner: key.owner });
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <Header />

      <main className="pt-16 pb-20">
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
          {/* Hero card */}
          <div className="rounded-2xl border border-white/10 bg-card p-6 md:p-8">
            <span className="text-[10px] md:text-xs uppercase tracking-[0.18em] text-amber-400 font-medium">
              Programmatic access · Closed Beta
            </span>
            <h1 className="mt-3 text-3xl md:text-4xl font-bold">API Keys</h1>
            <p className="mt-3 text-sm md:text-base text-muted-foreground max-w-3xl">
              Drive the Noether gateway from a script, bot, or your own
              dashboard. Authentication is wallet-bound: only addresses you
              control can issue keys, and every authed call is bound to the
              owner of the issuing key. While in test phase, key issuance
              is restricted to early-access wallets — public reads remain
              open to everyone.
            </p>

            <div className="mt-6 grid grid-cols-3 gap-4 md:gap-6 max-w-2xl">
              <Pill label="Auth model" value="Wallet-bound" />
              <Pill label="Rate limit" value="600/min" />
              <Pill label="Replay protection" value="60s" />
            </div>
          </div>

          {/* Issue card (handles beta gating internally) */}
          <ApiKeyIssueCard onIssued={onIssued} />

          {/* Active keys */}
          <ApiKeysList refreshKey={lastIssued} />

          {/* How it works */}
          <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10">
              <h3 className="text-base font-semibold text-foreground">How does it work?</h3>
            </div>
            <div className="p-6">
              <ol className="space-y-4 text-sm">
                <Step
                  num={1}
                  body="The gateway returns 32 random bytes scoped to your wallet address."
                />
                <Step
                  num={2}
                  body="Your wallet signs a SEP-10-style placeholder transaction carrying those bytes."
                />
                <Step
                  num={3}
                  body={
                    <>
                      The gateway verifies the signature against the
                      transaction hash and returns a fresh{' '}
                      <code className="text-xs px-1 py-0.5 rounded bg-zinc-900">keyId</code>
                      {' '}+{' '}
                      <code className="text-xs px-1 py-0.5 rounded bg-zinc-900">secret</code>.
                    </>
                  }
                />
                <Step
                  num={4}
                  body={
                    <>
                      Send{' '}
                      <code className="text-xs px-1 py-0.5 rounded bg-zinc-900">
                        Authorization: Bearer keyId:secret
                      </code>{' '}
                      and an{' '}
                      <code className="text-xs px-1 py-0.5 rounded bg-zinc-900">X-Timestamp</code>{' '}
                      header on every authenticated call.
                    </>
                  }
                />
              </ol>
            </div>
          </div>

          {/* Tier limits */}
          <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10">
              <h3 className="text-base font-semibold text-foreground">Rate-limit tiers</h3>
            </div>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Tier
                name="public"
                limit="60 req / min"
                note="IP-bound, no key needed"
              />
              <Tier
                name="standard"
                limit="600 req / min"
                note="Default for issued keys"
              />
              <Tier
                name="market_maker"
                limit="6000 req / min"
                note="Admin-promoted"
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-base md:text-xl font-bold">{value}</div>
    </div>
  );
}

function Step({ num, body }: { num: number; body: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex-none w-7 h-7 rounded-full bg-amber-500/15 text-amber-400 text-xs font-bold flex items-center justify-center mt-0.5">
        {num}
      </span>
      <p className="flex-1 text-muted-foreground leading-relaxed">{body}</p>
    </li>
  );
}

function Tier({ name, limit, note }: { name: string; limit: string; note: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-4">
      <code className="text-xs font-mono text-amber-400">{name}</code>
      <div className="mt-2 text-lg font-bold font-mono">{limit}</div>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
