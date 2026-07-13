'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { formatPairPrice } from '@/lib/utils/format';
import { NOERACLE_API_URL } from '@/lib/utils/constants';

interface OraclePriceCardProps {
  asset: string;
  /** Live mark from the Noeracle stream (0 = not yet received). */
  markPrice: number;
  /** Last attestation seen on the stream for this asset. */
  attestation?: { ts: number; roundId: number } | null;
  /** Global hourly funding rate in % (null = unknown). */
  fundingRate: number | null;
  /** Stream staleness flag from the page's SSE subscription. */
  stale: boolean;
}

/**
 * B10: the honest replacement for a fake order book on an oracle-priced
 * venue — one mark that fills, marks and liquidates, with its attestation
 * age ticking live. Turns the no-CLOB architecture into a transparency
 * feature instead of a ghost town.
 */
export function OraclePriceCard({ asset, markPrice, attestation, fundingRate, stale }: OraclePriceCardProps) {
  // 1s tick so the attestation age counts up between frames.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const ageSec = attestation ? Math.max(0, now - attestation.ts) : null;
  const ageTone =
    stale || (ageSec != null && ageSec > 60)
      ? 'text-short'
      : ageSec != null && ageSec > 10
      ? 'text-primary'
      : 'text-long';

  return (
    <div className="rounded-lg border border-border bg-surface p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-medium text-foreground">Oracle Price — {asset}-PERP</h3>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-[11px] font-medium',
            stale ? 'text-short' : 'text-long'
          )}
        >
          <span
            className={cn('h-1.5 w-1.5 rounded-full', stale ? 'bg-short' : 'bg-long animate-pulse')}
            aria-hidden="true"
          />
          {stale ? 'Stream stale — on-chain fallback' : 'Live'}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-faint mb-0.5">Mark</p>
          <p className="font-mono text-lg text-foreground tabular-nums">
            {markPrice > 0 ? formatPairPrice(asset, markPrice) : '—'}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-faint mb-0.5">Attestation age</p>
          <p className={cn('font-mono text-lg tabular-nums', ageTone)}>
            {ageSec == null ? '—' : `${ageSec}s`}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-faint mb-0.5">Funding / hr</p>
          <p
            className={cn(
              'font-mono text-lg tabular-nums',
              fundingRate == null
                ? 'text-muted-foreground'
                : fundingRate > 0
                ? 'text-short'
                : fundingRate < 0
                ? 'text-long'
                : 'text-muted-foreground'
            )}
            title="Positive = longs pay shorts"
          >
            {fundingRate == null ? '—' : `${fundingRate >= 0 ? '+' : ''}${fundingRate.toFixed(4)}%`}
          </p>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-faint leading-relaxed">
        One signed price marks, triggers and liquidates — there is no last/mark/index ambiguity on
        Noether. The market rejects prices older than 60s.{' '}
        <a
          href={`${NOERACLE_API_URL}/v1/latest`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground transition-colors"
        >
          View the signed attestation →
        </a>
      </p>
    </div>
  );
}
