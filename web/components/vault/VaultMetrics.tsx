'use client';

import type { VaultRow } from '@/types/vault';
import { vaultNav, vaultLeaderHoldingPct, VAULT_PRECISION } from '@/types/vault';

function fmtUsdc(raw: string, dp = 2): string {
  const value = BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / VAULT_PRECISION;
  const frac = abs % VAULT_PRECISION;
  const fracStr = frac.toString().padStart(7, '0').slice(0, dp);
  return `${negative ? '-' : ''}${whole}${dp > 0 ? '.' + fracStr : ''}`;
}

function fmtNav(nav: bigint): string {
  const whole = nav / VAULT_PRECISION;
  const frac = nav % VAULT_PRECISION;
  return `${whole}.${frac.toString().padStart(7, '0').slice(0, 4)}`;
}

function fmtShares(raw: string): string {
  const value = BigInt(raw);
  const whole = value / VAULT_PRECISION;
  const frac = value % VAULT_PRECISION;
  return `${whole}.${frac.toString().padStart(7, '0').slice(0, 2)}`;
}

interface Stat {
  label: string;
  value: string;
  hint?: string;
  tone?: 'success' | 'danger' | 'neutral';
}

function fmtBps(bps: number | undefined, signed = false): string {
  if (bps == null) return '—';
  const pct = bps / 100;
  const sign = signed && pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(pct < 10 ? 2 : 1)}%`;
}

export function VaultMetrics({ vault }: { vault: VaultRow }) {
  const nav = vaultNav(vault);
  const leaderPct = vaultLeaderHoldingPct(vault);
  const profitSharePct = (vault.profitShareBps / 100).toFixed(1);
  const realizedPnlNum = Number(vault.realizedPnl);
  const pnlTone: Stat['tone'] = realizedPnlNum > 0 ? 'success' : realizedPnlNum < 0 ? 'danger' : 'neutral';
  const apyTone: Stat['tone'] =
    vault.apyBps == null ? 'neutral' : vault.apyBps > 0 ? 'success' : vault.apyBps < 0 ? 'danger' : 'neutral';
  const drawdownTone: Stat['tone'] =
    (vault.drawdownBps ?? 0) > 1500 ? 'danger' : 'neutral';

  // Primary row — financial headline (SCF deliverable surface)
  const primary: Stat[] = [
    {
      label: 'Total Value Locked',
      value: `$${fmtUsdc(vault.totalUsdc)}`,
      hint: 'USDC pooled by all depositors',
    },
    {
      label: 'APY',
      value: fmtBps(vault.apyBps, true),
      hint: 'Annualised realized PnL / TVL',
      tone: apyTone,
    },
    {
      label: 'Max Drawdown',
      value: fmtBps(vault.drawdownBps),
      hint: '(HWM − current NAV) / HWM',
      tone: drawdownTone,
    },
  ];

  // Secondary row — operational
  const secondary: Stat[] = [
    {
      label: 'Open Positions',
      value: String(vault.openPositions ?? 0),
      hint: 'leader_open − leader_close events',
    },
    {
      label: 'Total Trades',
      value: String(vault.tradeCount ?? 0),
      hint: 'Lifetime trade count',
    },
    {
      label: 'Depositors',
      value: String(vault.depositorCount ?? 0),
      hint: 'Distinct wallet count from vault_deposits',
    },
  ];

  // Tertiary row — structural / governance
  const tertiary: Stat[] = [
    {
      label: 'NAV per Share',
      value: fmtNav(nav),
      hint: 'Net asset value, in USDC',
    },
    {
      label: 'Realized PnL',
      value: `${realizedPnlNum >= 0 ? '+' : ''}$${fmtUsdc(vault.realizedPnl)}`,
      hint: 'Closed trade profits returned to the pool',
      tone: pnlTone,
    },
    {
      label: 'Leader Holding',
      value: `${leaderPct.toFixed(2)}%`,
      hint: 'Must stay ≥ 5% — leader-skin invariant',
      tone: leaderPct >= 5 ? 'neutral' : 'danger',
    },
  ];

  return (
    <div className="space-y-4 md:space-y-6">
      <StatRow stats={primary} />
      <StatRow stats={secondary} />
      <StatRow stats={tertiary} />
    </div>
  );
}

function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 items-stretch gap-4 md:gap-6">
      {stats.map((s) => {
        const valueColor =
          s.tone === 'success'
            ? 'text-[#22c55e]'
            : s.tone === 'danger'
            ? 'text-red-400'
            : 'text-foreground';
        return (
          <div
            key={s.label}
            className="rounded-2xl border border-white/10 bg-card p-4 md:p-6"
          >
            <span className="text-xs md:text-sm text-muted-foreground">{s.label}</span>
            <div className="mt-2">
              <span className={`text-xl md:text-3xl font-bold font-mono ${valueColor}`}>
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
