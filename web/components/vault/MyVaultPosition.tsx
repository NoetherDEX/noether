'use client';

import { Card, CardContent } from '@/components/ui';
import { useWalletStore } from '@/lib/store';
import { VAULT_PRECISION, vaultNav } from '@/types/vault';
import type { VaultActivityRow, VaultRow } from '@/types/vault';

interface Props {
  vault: VaultRow;
  deposits: VaultActivityRow[];
  withdraws: VaultActivityRow[];
}

function fmtUsdc(raw: bigint): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const whole = abs / VAULT_PRECISION;
  const frac = abs % VAULT_PRECISION;
  return `${negative ? '-' : ''}${whole}.${frac.toString().padStart(7, '0').slice(0, 2)}`;
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
      <Card>
        <CardContent className="p-5 text-sm text-zinc-400">
          Connect your wallet to see your position in this vault.
        </CardContent>
      </Card>
    );
  }

  const depositedShares = sumSharesFor(deposits, address);
  const withdrawnShares = sumSharesFor(withdraws, address);
  const netShares = depositedShares - withdrawnShares;

  if (netShares <= 0n) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-zinc-400">
          You don't have a position in this vault yet. Use the Deposit button
          above to back the leader with USDC.
        </CardContent>
      </Card>
    );
  }

  const nav = vaultNav(vault);
  const value = (netShares * nav) / VAULT_PRECISION;
  const circ = BigInt(vault.circulatingShares);
  const poolPct = circ > 0n ? Number((netShares * 10_000n) / circ) / 100 : 0;
  const usdcIn = sumUsdcFor(deposits, address);
  const usdcOut = sumUsdcFor(withdraws, address);
  const realisedPnl = value + usdcOut - usdcIn;
  const pnlPos = realisedPnl >= 0n;

  const cells: Array<{ label: string; value: string; tone?: 'success' | 'danger' }> = [
    { label: 'Your shares', value: fmtUsdc(netShares) },
    { label: 'Value at NAV', value: `$${fmtUsdc(value)}` },
    { label: 'Pool share', value: `${poolPct.toFixed(2)}%` },
    {
      label: 'Unrealised P&L',
      value: `${pnlPos ? '+' : ''}$${fmtUsdc(realisedPnl)}`,
      tone: pnlPos ? 'success' : 'danger',
    },
  ];

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-5 py-3 border-b border-zinc-800">
          <h3 className="font-medium">Your position</h3>
          <p className="text-xs text-zinc-500">
            Computed from on-chain deposits ({deposits.filter((r) => r.principal === address).length})
            and withdraws ({withdraws.filter((r) => r.principal === address).length}) for{' '}
            <span className="font-mono">{address.slice(0, 4)}…{address.slice(-4)}</span>.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-5">
          {cells.map((c) => (
            <div key={c.label}>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">{c.label}</p>
              <p
                className={`text-lg font-semibold tabular-nums mt-1 ${
                  c.tone === 'success' ? 'text-emerald-400' : ''
                } ${c.tone === 'danger' ? 'text-red-400' : ''}`}
              >
                {c.value}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
