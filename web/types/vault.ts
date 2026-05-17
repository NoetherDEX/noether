// Vault marketplace types — mirrors the API gateway's response shape.
// Kept self-contained for now; will switch to @noether/sdk imports
// once web/ joins the monorepo workspace.

export interface VaultRow {
  id: number;
  leader: string;
  name: string;
  createdAt: number;
  totalUsdc: string;
  circulatingShares: string;
  hwmNav: string;
  realizedPnl: string;
  leaderShares: string;
  profitShareBps: number;
  paused: boolean;
  updatedAt: number;
}

export interface VaultActivityRow {
  id: number;
  vaultId: number;
  principal: string;
  amount: string;
  shares?: string;
  ledger: number;
  ts: number;
  txHash: string;
}

/** PRECISION = 10^7 (Stellar's 7-decimal fixed point). */
export const VAULT_PRECISION = 10_000_000n;
export const BPS_DENOM = 10_000;

export function vaultNav(row: Pick<VaultRow, 'totalUsdc' | 'circulatingShares'>): bigint {
  const usdc = BigInt(row.totalUsdc);
  const shares = BigInt(row.circulatingShares);
  if (shares === 0n) return VAULT_PRECISION;
  return (usdc * VAULT_PRECISION) / shares;
}

export function vaultLeaderHoldingPct(row: Pick<VaultRow, 'leaderShares' | 'circulatingShares'>): number {
  const lead = BigInt(row.leaderShares);
  const circ = BigInt(row.circulatingShares);
  if (circ === 0n) return 0;
  return Number((lead * 10_000n) / circ) / 100;
}

import type { OnChainVaultInfo } from '@/lib/stellar/vaultFactory';

/**
 * Adapter — turns the contract's `view_vault` output into the same
 * shape the (legacy) API gateway returns. Lets the UI components be
 * indifferent to where the data came from.
 */
export function vaultRowFromOnChain(info: OnChainVaultInfo): VaultRow {
  return {
    id: info.id,
    leader: info.leader,
    name: info.name,
    createdAt: info.createdAt,
    totalUsdc: info.totalUsdc.toString(),
    circulatingShares: info.circulatingShares.toString(),
    hwmNav: info.hwmNav.toString(),
    realizedPnl: info.realizedPnl.toString(),
    leaderShares: info.leaderShares.toString(),
    profitShareBps: info.profitShareBps,
    paused: info.paused,
    updatedAt: Date.now(),
  };
}
