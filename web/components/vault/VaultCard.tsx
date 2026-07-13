'use client';

import Link from 'next/link';
import { Card, CardContent, Badge } from '@/components/ui';
import type { VaultRow } from '@/types/vault';
import { vaultNav } from '@/types/vault';
import { fmtUsdc7 } from '@/lib/utils/format';

function shortenAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
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

  const apyValue = vault.apyBps;
  const apyClass =
    apyValue == null
      ? 'text-foreground'
      : apyValue > 0
      ? 'text-long'
      : apyValue < 0
      ? 'text-short'
      : 'text-foreground';

  return (
    <Link href={`/vaults/${vault.id}`} className="block group">
      <Card className="hover:border-border-strong transition-colors" padding="none">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-medium text-sm text-foreground truncate group-hover:text-primary transition-colors">
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
          <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border">
            <Metric label="TVL (liquid)" value={`$${fmtUsdc7(vault.totalUsdc)}`} />
            {/* Young vaults report the raw since-inception return — labelling
                it APY would fabricate triple-digit annual rates from days-old
                track records (B17). */}
            <Metric
              label={vault.apyKind === 'inception' ? 'Since inception' : 'APY'}
              value={fmtBps(apyValue, true)}
              valueClass={apyClass}
            />
            <Metric label="Drawdown" value={fmtBps(vault.drawdownBps)} />
          </div>
          <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border">
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
            <Metric label="Liquid NAV" value={fmtUsdc7(nav, 4)} compact />
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
      <p className="text-[11px] uppercase tracking-wide text-faint">{label}</p>
      <p
        className={`tabular-nums font-mono ${
          compact ? 'text-xs' : 'text-sm font-medium'
        } ${valueClass ?? 'text-foreground'}`}
      >
        {value}
      </p>
    </div>
  );
}
