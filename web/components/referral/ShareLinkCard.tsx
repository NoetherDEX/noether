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
    <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
      <div className="px-6 py-4 border-b border-white/10">
        <h3 className="text-base font-semibold text-foreground">Share your code</h3>
        <p className="text-xs md:text-sm text-muted-foreground mt-1">
          Anyone signing up with your code gets a 4% fee discount. You earn 10%
          of every fee they pay, forever.
        </p>
      </div>

      <div className="p-6 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Code
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-4 py-3 bg-zinc-900/60 border border-white/10 rounded-xl text-base font-mono">
              {code}
            </code>
            <Button onClick={() => copy(code, 'code')} size="sm" variant="ghost">
              {copiedCode ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Share link
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-4 py-3 bg-zinc-900/60 border border-white/10 rounded-xl text-xs font-mono break-all">
              {link}
            </code>
            <Button onClick={() => copy(link, 'link')} size="sm">
              {copiedLink ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
