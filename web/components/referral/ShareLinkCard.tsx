'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';

export function ShareLinkCard({ code }: { code: string }) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const link =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?ref=${encodeURIComponent(code)}`
      : `https://noether.exchange/?ref=${encodeURIComponent(code)}`;

  async function copy(text: string, kind: 'code' | 'link') {
    try {
      await navigator.clipboard.writeText(text);
      if (kind === 'code') {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      } else {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      }
    } catch {
      // ignore — clipboard may be unavailable in some embeds
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <h3 className="text-[13px] font-medium text-foreground">Share your code</h3>
      </div>

      <div className="p-5 space-y-4">
        <p className="text-[11px] text-faint leading-relaxed">
          Your invitees accept with one signed transaction (from the link
          banner or the code box on the Referrals page) — the binding is
          on-chain today. From v1.1 they get a 4% fee discount and you earn
          10% of every fee they pay.
        </p>

        <div>
          <p className="text-[11px] uppercase tracking-wide text-faint mb-1.5">
            Code
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-surface-2 border border-border rounded-md text-sm font-mono">
              {code}
            </code>
            <Button onClick={() => copy(code, 'code')} size="sm" variant="ghost">
              {copiedCode ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-wide text-faint mb-1.5">
            Share link
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-surface-2 border border-border rounded-md text-xs font-mono break-all">
              {link}
            </code>
            <Button onClick={() => copy(link, 'link')} size="sm" variant="secondary">
              {copiedLink ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
