'use client';

import { useWalletStore } from '@/lib/store';
import { VAULT_PRECISION, vaultNav } from '@/types/vault';
import type { VaultActivityRow, VaultRow } from '@/types/vault';

interface Props {
  vault: VaultRow;
  deposits: VaultActivityRow[];
  withdraws: VaultActivityRow[];
}

function fmtUsdc(raw: bigint, dp = 2): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const whole = abs / VAULT_PRECISION;
  const frac = abs % VAULT_PRECISION;
  return `${negative ? '-' : ''}${whole}.${frac.toString().padStart(7, '0').slice(0, dp)}`;
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
      <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10">
          <h3 className="text-base font-semibold text-foreground">Your Position</h3>
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
      <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10">
          <h3 className="text-base font-semibold text-foreground">Your Position</h3>
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
  const pnlPos = pnl >= 0n;

  return (
    <div className="rounded-2xl border border-white/10 bg-card overflow-hidden">
      <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground">Your Position</h3>
        <span className="text-xs text-muted-foreground font-mono">
          {depCount} deposit{depCount !== 1 && 's'} · {wdCount} withdraw{wdCount !== 1 && 's'} ·{' '}
          {address.slice(0, 4)}…{address.slice(-4)}
        </span>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
          <Cell label="Your Shares" value={fmtUsdc(netShares, 4)} />
          <Cell label="Value at NAV" value={`$${fmtUsdc(value)}`} />
          <Cell label="Pool Share" value={`${poolPct.toFixed(2)}%`} />
          <Cell
            label="Unrealised P&L"
            value={`${pnlPos ? '+' : ''}$${fmtUsdc(pnl)}`}
            tone={pnlPos ? 'success' : 'danger'}
          />
        </div>
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
    tone === 'success' ? 'text-[#22c55e]' : tone === 'danger' ? 'text-red-400' : 'text-foreground';
  return (
    <div>
      <p className="text-xs md:text-sm text-muted-foreground">{label}</p>
      <p className={`mt-2 text-xl md:text-2xl font-bold font-mono ${color}`}>{value}</p>
    </div>
  );
}
