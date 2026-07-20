'use client';

/**
 * L0-15 two-tier pause banner (Batch-1). Polls the market's get_pause_state
 * view every 30s: mode 0 (or a pre-Batch-1 market returning null) renders
 * nothing; mode 1 = amber exit-only strip; mode 2 = red full-freeze strip
 * (auto-degrades to mode 1 on-chain after 72h). Pointer-events-none like
 * the testnet ribbon — informational chrome, never a click shield.
 */

import { useEffect, useState } from 'react';
import { getPauseState } from '@/lib/stellar/market';

const POLL_MS = 30_000;

export function PauseBanner() {
  const [mode, setMode] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const state = await getPauseState();
      if (!cancelled) setMode(state?.mode ?? 0);
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (mode === 0) return null;
  const frozen = mode >= 2;

  return (
    <div
      data-noether-chrome
      className="pointer-events-none fixed inset-x-0 top-6 z-[90] flex justify-center px-4"
    >
      <span
        className={
          frozen
            ? 'rounded-md border border-short/40 bg-[#2a1215]/95 px-3 py-1 text-[11px] font-medium text-short'
            : 'rounded-md border border-[#eab308]/40 bg-[#2a2312]/95 px-3 py-1 text-[11px] font-medium text-[#eab308]'
        }
      >
        {frozen
          ? 'Market frozen — only order cancellation is available while the incident is investigated.'
          : 'Trading paused (exit-only) — closes, protective orders, cancels and withdrawals work; new positions are disabled.'}
      </span>
    </div>
  );
}
