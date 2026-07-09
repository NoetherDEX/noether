'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui';
import { toUserMessage } from '@/lib/utils/userError';

/**
 * Route-segment error boundary. Catches render/runtime errors thrown by any
 * page under app/ and shows a branded recovery card instead of Next.js's
 * default error overlay. `reset()` re-renders the segment; a full reload is the
 * escape hatch when a re-render alone won't recover.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app/error]', error);
  }, [error]);

  return (
    <>
      {/* Hide the floating referral banner + other layout chrome behind the
          recovery card (same treatment as not-found). */}
      <style dangerouslySetInnerHTML={{ __html: '[data-noether-chrome]{display:none !important;}' }} />
      <main className="min-h-screen w-full bg-[#0a0a0a] flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-red-500/30 bg-card overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-red-500/40 via-red-400 to-red-500/40" />
          <div className="p-6 md:p-8 space-y-4 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-red-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="space-y-1.5">
              <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
              <p className="text-sm text-muted-foreground">
                This page hit an unexpected error. Try again, or reload if that
                doesn&apos;t help.
              </p>
            </div>
            <p className="text-xs font-mono text-muted-foreground/60 break-words">
              {toUserMessage(error)}
            </p>
            <div className="flex items-center justify-center gap-2 pt-1">
              <Button onClick={reset}>Try again</Button>
              <Button variant="ghost" onClick={() => window.location.reload()}>
                Reload page
              </Button>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
