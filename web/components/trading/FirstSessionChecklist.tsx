'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { IS_MAINNET_BUILD } from '@/lib/utils/constants';

const DISMISS_KEY = 'noether-first-session-dismissed';

interface FirstSessionChecklistProps {
  isConnected: boolean;
  /** null = balance unknown (read failed) — the step stays visible. */
  xlmBalance: number | null;
  usdcBalance: number | null;
  /** Any open position or order — the wallet has traded. */
  hasTraded: boolean;
}

/**
 * B22: the guided path from empty wallet to first trade. Every competitor
 * makes new users find the faucet/trustline steps themselves; this renders
 * the funnel inline and disappears once the wallet has on-chain history
 * (or is dismissed).
 */
export function FirstSessionChecklist({
  isConnected,
  xlmBalance,
  usdcBalance,
  hasTraded,
}: FirstSessionChecklistProps) {
  const [dismissed, setDismissed] = useState(true); // SSR-safe: hidden until read
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  const steps = [
    {
      key: 'connect',
      label: 'Connect a Stellar wallet',
      done: isConnected,
      cta: null, // the header's Connect Wallet button is always visible
      hint: 'Use the Connect Wallet button in the top right (Freighter or LOBSTR).',
    },
    {
      key: 'fund',
      label: 'Fund the account with XLM (gas)',
      done: isConnected && xlmBalance != null && xlmBalance >= 1,
      cta: IS_MAINNET_BUILD ? undefined : { href: '/faucet', label: 'Fund via faucet →' },
      hint: IS_MAINNET_BUILD
        ? 'Your wallet needs a little XLM to pay network fees.'
        : 'New testnet accounts start empty — the faucet funds them for free.',
    },
    {
      key: 'usdc',
      label: IS_MAINNET_BUILD ? 'Hold USDC (collateral)' : 'Claim test USDC (collateral)',
      done: isConnected && usdcBalance != null && usdcBalance > 0,
      cta: IS_MAINNET_BUILD ? undefined : { href: '/faucet', label: 'Claim USDC →' },
      hint: IS_MAINNET_BUILD
        ? 'Deposit or swap into USDC on Stellar to trade.'
        : 'Up to 1,000 test USDC per day.',
    },
    {
      key: 'trade',
      label: 'Open your first position',
      done: hasTraded,
      cta: null,
      hint: 'Pick a size and leverage in the order panel — fills at the oracle price.',
    },
  ];

  const allDone = steps.every((s) => s.done);
  if (dismissed || allDone) return null;

  const firstOpen = steps.findIndex((s) => !s.done);

  return (
    <div className="mb-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.15em] text-faint">
          Getting started
        </h3>
        <button
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.setItem(DISMISS_KEY, '1');
            } catch {}
          }}
          className="p-1 rounded-sm text-faint hover:text-foreground transition-colors"
          aria-label="Dismiss getting-started checklist"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <ol className="space-y-1.5">
        {steps.map((step, i) => (
          <li key={step.key} className="flex items-start gap-2">
            <span
              className={cn(
                'mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border text-[9px] font-mono',
                step.done
                  ? 'border-long/40 bg-long/10 text-long'
                  : i === firstOpen
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border text-faint'
              )}
              aria-hidden="true"
            >
              {step.done ? <Check className="w-2.5 h-2.5" /> : i + 1}
            </span>
            <div className="min-w-0">
              <p
                className={cn(
                  'text-xs leading-tight',
                  step.done ? 'text-faint line-through' : i === firstOpen ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {step.label}
                {!step.done && i === firstOpen && step.cta && (
                  <>
                    {' '}
                    <Link href={step.cta.href} className="text-primary underline hover:opacity-80">
                      {step.cta.label}
                    </Link>
                  </>
                )}
              </p>
              {!step.done && i === firstOpen && (
                <p className="text-[11px] text-faint mt-0.5">{step.hint}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
