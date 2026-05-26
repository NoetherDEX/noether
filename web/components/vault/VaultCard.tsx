'use client';

import Link from 'next/link';
import { Card, CardContent, Badge } from '@/components/ui';
import type { VaultRow } from '@/types/vault';
import { vaultNav, VAULT_PRECISION } from '@/types/vault';

function shortenAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function fmtUsdc(raw: string, dp = 2): string {
  const value = BigInt(raw);
  const whole = value / VAULT_PRECISION;
  const frac = value % VAULT_PRECISION;
  return `${whole}.${frac.toString().padStart(7, '0').slice(0, dp)}`;
}

function fmtBps(bps: number | undefined, signed = false): string {
  if (bps == null) return '—';
  const pct = bps / 100;
  const sign = signed && pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(pct < 10 ? 2 : 1)}%`;
}

/**
 * Marketplace card — surfaces the five SCF Tranche 2 metrics
 * (name · APY · TVL · drawdown · depositor count) plus open-trades
 * and NAV as secondary context. Falls back to em-dash when the
 * indexer hasn't produced an aggregate yet (brand-new vault).
 */
export function VaultCard({ vault }: { vault: VaultRow }) {
  const nav = vaultNav(vault);
  const navFloat = Number(nav) / 1e7;

  const apyValue = vault.apyBps;
  const apyClass =
    apyValue == null
      ? 'text-foreground'
      : apyValue > 0
      ? 'text-[#22c55e]'
      : apyValue < 0
      ? 'text-red-400'
      : 'text-foreground';

  return (
    <Link href={`/vaults/${vault.id}`} className="block group">
      <Card className="hover:border-amber-500/30 transition-colors">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-semibold text-lg truncate group-hover:text-amber-300 transition-colors">
                {vault.name}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Leader · <span className="font-mono">{shortenAddress(vault.leader)}</span>
                {' · '}#{vault.id}
              </p>
            </div>
            {vault.paused && <Badge variant="warning">Paused</Badge>}
          </div>

          {/* Primary stats — 5 SCF-required metrics on two rows */}
          <div className="grid grid-cols-3 gap-3 pt-3 border-t border-white/5">
            <Metric label="TVL" value={`$${fmtUsdc(vault.totalUsdc)}`} />
            <Metric label="APY" value={fmtBps(apyValue, true)} valueClass={apyClass} />
            <Metric label="Drawdown" value={fmtBps(vault.drawdownBps)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Metric
              label="Depositors"
              value={String(vault.depositorCount ?? '—')}
              compact
            />
            <Metric
              label="Open trades"
              value={String(vault.openPositions ?? '—')}
              compact
            />
            <Metric label="NAV" value={navFloat.toFixed(4)} compact />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Metric({
  label,
  value,
  valueClass,
  compact,
}: {
  label: string;
  value: string;
  valueClass?: string;
  compact?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={`tabular-nums font-mono ${
          compact ? 'text-xs' : 'text-base font-semibold'
        } ${valueClass ?? 'text-foreground'}`}
      >
        {value}
      </p>
    </div>
  );
}
