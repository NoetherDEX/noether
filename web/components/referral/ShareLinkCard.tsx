'use client';

import { useState } from 'react';
import { Button, Card, CardContent } from '@/components/ui';

export function ShareLinkCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const link = typeof window !== 'undefined'
    ? `${window.location.origin}/?ref=${encodeURIComponent(code)}`
    : `https://noether.exchange/?ref=${encodeURIComponent(code)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — clipboard may be unavailable in some embeds
    }
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div>
          <h3 className="font-medium">Share your code</h3>
          <p className="text-sm text-zinc-500">
            Anyone you refer earns a 4% fee discount. You earn 10% of the fees they
            pay forever.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-xs font-mono break-all">
            {link}
          </code>
          <Button onClick={copy} size="sm">
            {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
