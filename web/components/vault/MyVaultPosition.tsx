'use client';

import { useWalletStore } from '@/lib/store';
import { VAULT_PRECISION, vaultNav } from '@/types/vault';
import type { VaultActivityRow, VaultRow } from '@/types/vault';
import { fmtUsdc7 } from '@/lib/utils/format';

interface Props {
  vault: VaultRow;
  deposits: VaultActivityRow[];
  withdraws: VaultActivityRow[];
}

function sumSharesFor(rows: VaultActivityRow[], principal: string): bigint {
  return rows
    .filter((r) => r.principal === principal && r.shares)
    .reduce((acc, r) => acc + BigInt(r.shares ?? '0'), 0n);
}

function sumUsdcFor(rows: VaultActivityRow[], principal: string): bigint {
  return rows
    .filter((r) => r.principal === principal)
    .reduce((acc, r) => acc + BigInt(r.amount), 0n);
}

export function MyVaultPosition({ vault, deposits, withdraws }: Props) {
  const address = useWalletStore((s) => s.address);

  if (!address) {
    return (
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-sm font-medium text-foreground">Your Position</h3>
        </div>
        <div className="p-6 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            Connect your wallet to view your position in this vault.
          </p>
        </div>
      </div>
    );
  }

  const depositedShares = sumSharesFor(deposits, address);
  const withdrawnShares = sumSharesFor(withdraws, address);
  const netShares = depositedShares - withdrawnShares;
  const depCount = deposits.filter((r) => r.principal === address).length;
  const wdCount = withdraws.filter((r) => r.principal === address).length;

  if (netShares <= 0n) {
    return (
      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-sm font-medium text-foreground">Your Position</h3>
        </div>
        <div className="p-6 py-8 text-center">
          <p className="text-sm text-foreground mb-1">No position yet</p>
          <p className="text-xs text-muted-foreground">
            Deposit USDC above to back the leader and earn a share of their PnL.
          </p>
        </div>
      </div>
    );
  }

  const nav = vaultNav(vault);
  const value = (netShares * nav) / VAULT_PRECISION;
  const circ = BigInt(vault.circulatingShares);
  const poolPct = circ > 0n ? Number((netShares * 10_000n) / circ) / 100 : 0;
  const usdcIn = sumUsdcFor(deposits, address);
  const usdcOut = sumUsdcFor(withdraws, address);
  const pnl = value + usdcOut - usdcIn;
  // While the leader has capital deployed, the liquid NAV understates the
  // vault by the deployed amount — the "loss" is (mostly) an accounting dip,
  // not a realized one. Don't paint it red/green; explain instead (A20).
  const capitalDeployed = (vault.openPositions ?? 0) > 0;
  const pnlAbs = pnl < 0n ? -pnl : pnl;
  const pnlDisplay =
    pnl === 0n ? `$${fmtUsdc7(pnl)}` : `${pnl < 0n ? '-' : '+'}$${fmtUsdc7(pnlAbs)}`;
  const pnlTone: 'success' | 'danger' | undefined = capitalDeployed
    ? undefined
    : pnl > 0n
    ? 'success'
    : pnl < 0n
    ? 'danger'
    : undefined;

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Your Position</h3>
        <span className="text-xs text-muted-foreground font-mono tabular-nums">
          {depCount} deposit{depCount !== 1 && 's'} · {wdCount} withdraw{wdCount !== 1 && 's'} ·{' '}
          {address.slice(0, 4)}…{address.slice(-4)}
        </span>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
          <Cell label="Your Shares" value={fmtUsdc7(netShares, 4)} />
          <Cell label="Value at liquid NAV" value={`$${fmtUsdc7(value)}`} />
          <Cell label="Pool Share" value={`${poolPct.toFixed(2)}%`} />
          <Cell label="Net P&L (est.)" value={pnlDisplay} tone={pnlTone} />
        </div>
        {capitalDeployed && (
          <p className="mt-4 border-l-2 border-primary/60 pl-3 text-xs text-muted-foreground">
            The leader has {vault.openPositions} open position
            {vault.openPositions === 1 ? '' : 's'} — value and P&amp;L above count
            only liquid capital and exclude your share of what is deployed in
            trades. They settle when the positions close.
          </p>
        )}
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger';
}) {
  const color =
    tone === 'success' ? 'text-long' : tone === 'danger' ? 'text-short' : 'text-foreground';
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-faint">{label}</p>
      <p className={`mt-2 text-lg md:text-xl font-medium font-mono tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
