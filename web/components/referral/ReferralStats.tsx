'use client';

import { Card, CardContent } from '@/components/ui';
import type { ReferrerRow } from '@/types/referral';
import { fmtReferralUsdc } from '@/types/referral';

export function ReferralStats({ row }: { row: ReferrerRow }) {
  const stats: Array<{ label: string; value: string; tone?: 'success' | 'muted' }> = [
    { label: 'Code', value: row.code },
    { label: 'Referees', value: String(row.referredCount) },
    { label: 'Volume Generated', value: `$${fmtReferralUsdc(row.totalVolumeGenerated)}` },
    { label: 'Total Earned', value: `$${fmtReferralUsdc(row.totalEarned)}`, tone: 'muted' },
    { label: 'Claimable Now', value: `$${fmtReferralUsdc(row.claimable)}`, tone: 'success' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {stats.map((s) => (
        <Card key={s.label}>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">{s.label}</p>
            <p
              className={`text-lg font-semibold tabular-nums mt-1 ${
                s.tone === 'success' ? 'text-emerald-400' : ''
              } ${s.tone === 'muted' ? 'text-zinc-400' : ''}`}
            >
              {s.value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
