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
    <div className="space-y-4 md:space-y-6">
      <StatRow stats={primary} mono />
      <StatRow stats={secondary} />
    </div>
  );
}

function StatRow({ stats, mono = false }: { stats: Stat[]; mono?: boolean }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 items-stretch gap-4 md:gap-6">
      {stats.map((s) => {
        const valueColor =
          s.tone === 'success'
            ? 'text-[#22c55e]'
            : s.tone === 'muted'
            ? 'text-muted-foreground'
            : 'text-foreground';
        return (
          <div
            key={s.label}
            className="rounded-2xl border border-white/10 bg-card p-4 md:p-6"
          >
            <span className="text-xs md:text-sm text-muted-foreground">{s.label}</span>
            <div className="mt-2">
              <span
                className={`text-xl md:text-3xl font-bold ${mono ? 'font-mono' : ''} ${valueColor}`}
              >
                {s.value}
              </span>
            </div>
            {s.hint && (
              <p className="mt-2 text-xs text-muted-foreground hidden md:block">{s.hint}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
