'use client';

import Link from 'next/link';
import { Card, CardContent, Badge } from '@/components/ui';
import type { VaultRow } from '@/types/vault';
import { vaultNav, vaultLeaderHoldingPct, VAULT_PRECISION } from '@/types/vault';

function shortenAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function fmtUsdc(raw: string): string {
  const value = BigInt(raw);
  const whole = value / VAULT_PRECISION;
  const frac = value % VAULT_PRECISION;
  return `${whole}.${frac.toString().padStart(7, '0').slice(0, 2)}`;
}

function fmtNav(nav: bigint): string {
  // PRECISION-scaled bigint → decimal string with 4 dp
  const whole = nav / VAULT_PRECISION;
  const frac = nav % VAULT_PRECISION;
  return `${whole}.${frac.toString().padStart(7, '0').slice(0, 4)}`;
}

export function VaultCard({ vault }: { vault: VaultRow }) {
  const nav = vaultNav(vault);
  const leaderPct = vaultLeaderHoldingPct(vault);

  return (
    <Link href={`/vaults/${vault.id}`} className="block">
      <Card className="hover:border-blue-500/40 transition-colors">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-lg">{vault.name}</h3>
              <p className="text-xs text-zinc-500">
                Leader · {shortenAddress(vault.leader)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              {vault.paused && <Badge variant="warning">Paused</Badge>}
              <span className="text-xs text-zinc-500">#{vault.id}</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-zinc-800">
            <Metric label="TVL" value={`$${fmtUsdc(vault.totalUsdc)}`} />
            <Metric label="NAV" value={fmtNav(nav)} />
            <Metric label="Leader" value={`${leaderPct.toFixed(1)}%`} />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}
