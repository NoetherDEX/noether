'use client';

import { Card, CardContent } from '@/components/ui';
import type { VaultRow } from '@/types/vault';
import { vaultNav, vaultLeaderHoldingPct, VAULT_PRECISION } from '@/types/vault';

function fmtUsdc(raw: string, dp = 2): string {
  const value = BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / VAULT_PRECISION;
  const frac = abs % VAULT_PRECISION;
  return `${negative ? '-' : ''}${whole}.${frac.toString().padStart(7, '0').slice(0, dp)}`;
}

function fmtNav(nav: bigint): string {
  const whole = nav / VAULT_PRECISION;
  const frac = nav % VAULT_PRECISION;
  return `${whole}.${frac.toString().padStart(7, '0').slice(0, 4)}`;
}

export function VaultMetrics({ vault }: { vault: VaultRow }) {
  const nav = vaultNav(vault);
  const leaderPct = vaultLeaderHoldingPct(vault);
  const profitSharePct = (vault.profitShareBps / 100).toFixed(1);

  const metrics: Array<{ label: string; value: string; tone?: 'success' | 'danger' }> = [
    { label: 'Total Value Locked', value: `$${fmtUsdc(vault.totalUsdc)}` },
    { label: 'NAV per Share', value: fmtNav(nav) },
    { label: 'Realized PnL', value: `$${fmtUsdc(vault.realizedPnl)}` },
    { label: 'Circulating Shares', value: fmtUsdc(vault.circulatingShares, 0) },
    { label: 'Leader Holding', value: `${leaderPct.toFixed(2)}%` },
    { label: 'Leader Profit Share', value: `${profitSharePct}%` },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {metrics.map((m) => (
        <Card key={m.label}>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">
              {m.label}
            </p>
            <p className="text-lg font-semibold tabular-nums mt-1">{m.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
