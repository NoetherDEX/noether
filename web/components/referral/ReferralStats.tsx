'use client';

import type { ReferrerRow } from '@/types/referral';
import { fmtReferralUsdc } from '@/types/referral';
import { formatDate } from '@/lib/utils/format';

interface Stat {
  label: string;
  value: string;
  hint?: string;
  tone?: 'success' | 'muted' | 'neutral';
}

export function ReferralStats({ row }: { row: ReferrerRow }) {
  const primary: Stat[] = [
    {
      label: 'Total Earned',
      value: `$${fmtReferralUsdc(row.totalEarned)}`,
      hint: 'Lifetime credits to your code — accrual starts in v1.1',
    },
    {
      label: 'Claimable',
      value: `$${fmtReferralUsdc(row.claimable)}`,
      hint: 'Pending USDC — payouts open in v1.1',
      tone: BigInt(row.claimable || '0') > 0n ? 'success' : 'neutral',
    },
    {
      label: 'Volume Generated',
      value: `$${fmtReferralUsdc(row.totalVolumeGenerated)}`,
      hint: 'Cumulative referee trading volume',
    },
  ];

  const secondary: Stat[] = [
    {
      label: 'Your Code',
      value: row.code,
    },
    {
      label: 'Referees',
      value: String(row.referredCount),
      hint: 'Wallets bound to your code',
    },
    {
      label: 'Registered',
      value: formatDate(row.createdAt),
    },
  ];

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <StatRow stats={primary} large className="border-b border-border" />
      <StatRow stats={secondary} />
    </div>
  );
}

function StatRow({
  stats,
  large = false,
  className = '',
}: {
  stats: Stat[];
  large?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border ${className}`}
    >
      {stats.map((s) => {
        const valueColor =
          s.tone === 'success'
            ? 'text-long'
            : s.tone === 'muted'
            ? 'text-muted-foreground'
            : 'text-foreground';
        return (
          <div key={s.label} className="min-w-0 px-4 py-3">
            <span className="text-[11px] uppercase tracking-wide text-faint">{s.label}</span>
            <div className="mt-1">
              <span
                className={`${large ? 'text-lg' : 'text-sm'} font-medium font-mono tabular-nums ${valueColor} break-all`}
              >
                {s.value}
              </span>
            </div>
            {s.hint && (
              <p className="mt-1 text-[11px] text-faint hidden md:block">{s.hint}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
