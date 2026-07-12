'use client';

import type { VaultRow } from '@/types/vault';
import { vaultNav, vaultLeaderHoldingPct } from '@/types/vault';
import { fmtUsdc7 } from '@/lib/utils/format';

/** Signed money display built ON fmtUsdc7 — sign outside the '$'
 *  ('+$1,234.56' / '-$1,234.56'), exact zero stays unsigned. */
function fmtSignedUsd(raw: string): string {
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    return '—';
  }
  if (value === 0n) return `$${fmtUsdc7(value)}`;
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : '+'}$${fmtUsdc7(abs)}`;
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
  // Closed-trade PnL is the lifetime gain from closed leader trades
  // returned to the pool — what the LP cares about. The contract's
  // realizedPnl tracks something different (leader profit-share
  // payouts), surfaced in its own tile below.
  const closedPnl = vault.closedTradePnl ?? '0';
  const closedPnlNum = Number(closedPnl);
  const closedPnlTone: Stat['tone'] =
    closedPnlNum > 0 ? 'success' : closedPnlNum < 0 ? 'danger' : 'neutral';
  const feesClaimedNum = Number(vault.realizedPnl);
  const feesClaimedTone: Stat['tone'] =
    feesClaimedNum > 0 ? 'success' : feesClaimedNum < 0 ? 'danger' : 'neutral';
  const apyTone: Stat['tone'] =
    vault.apyBps == null ? 'neutral' : vault.apyBps > 0 ? 'success' : vault.apyBps < 0 ? 'danger' : 'neutral';
  const drawdownTone: Stat['tone'] =
    (vault.drawdownBps ?? 0) > 1500 ? 'danger' : 'neutral';

  // Primary row — financial headline (SCF deliverable surface)
  const primary: Stat[] = [
    {
      label: 'TVL (liquid)',
      value: `$${fmtUsdc7(vault.totalUsdc)}`,
      hint: 'USDC sitting in the vault — excludes capital deployed in open positions',
    },
    {
      label: 'APY',
      value: fmtBps(vault.apyBps, true),
      hint: 'Annualised closed-trade PnL / TVL',
      tone: apyTone,
    },
    {
      label: 'Max Drawdown',
      value: fmtBps(vault.drawdownBps),
      hint: '(HWM − current liquid NAV) / HWM',
      tone: drawdownTone,
    },
  ];

  // Secondary row — operational. Unknown aggregates render '—', never a
  // fabricated 0 (money-display honesty rule).
  const secondary: Stat[] = [
    {
      label: 'Open Positions',
      value: vault.openPositions != null ? String(vault.openPositions) : '—',
      hint: 'leader_open − leader_close events',
    },
    {
      label: 'Total Trades',
      value: vault.tradeCount != null ? String(vault.tradeCount) : '—',
      hint: 'Lifetime trade count',
    },
    {
      label: 'Depositors',
      value: vault.depositorCount != null ? String(vault.depositorCount) : '—',
      hint: 'Distinct wallet count from vault_deposits',
    },
  ];

  // Tertiary row — structural / governance / pnl breakdown
  const tertiary: Stat[] = [
    {
      label: 'Liquid NAV per Share',
      value: fmtUsdc7(nav, 4),
      hint: 'Counts only liquid USDC — deployed capital excluded',
    },
    {
      label: 'Realized PnL',
      value: fmtSignedUsd(closedPnl),
      hint: 'Closed trade profits returned to the pool',
      tone: closedPnlTone,
    },
    {
      label: 'Leader Fees Claimed',
      value: fmtSignedUsd(vault.realizedPnl),
      hint: 'Lifetime profit-share paid out to the leader',
      tone: feesClaimedTone,
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
      <StatRow stats={tertiary} cols={4} />
    </div>
  );
}

function StatRow({ stats, cols = 3 }: { stats: Stat[]; cols?: 3 | 4 }) {
  const gridCols = cols === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3';
  return (
    <div className={`grid grid-cols-1 ${gridCols} items-stretch gap-4 md:gap-6`}>
      {stats.map((s) => {
        const valueColor =
          s.tone === 'success'
            ? 'text-long'
            : s.tone === 'danger'
            ? 'text-short'
            : 'text-foreground';
        return (
          <div
            key={s.label}
            className="rounded-lg border border-border bg-surface p-4 md:p-5"
          >
            <span className="text-[11px] uppercase tracking-wide text-faint">{s.label}</span>
            <div className="mt-2">
              <span className={`text-lg md:text-xl font-medium font-mono tabular-nums ${valueColor}`}>
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
