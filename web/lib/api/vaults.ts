/**
 * Thin REST client for the vault marketplace endpoints.
 * Targets the @noether/api gateway via NEXT_PUBLIC_NOETHER_API_URL.
 */

import type { VaultActivityRow, VaultRow, VaultTradeRow } from '@/types/vault';

const API_BASE = process.env.NEXT_PUBLIC_NOETHER_API_URL ?? 'http://localhost:4000';

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { accept: 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text || path}`);
  }
  return (await res.json()) as T;
}

export async function listVaults(opts?: { leader?: string; limit?: number }): Promise<VaultRow[]> {
  const params = new URLSearchParams();
  if (opts?.leader) params.set('leader', opts.leader);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  const { vaults } = await fetchJson<{ vaults: VaultRow[] }>(`/v1/vaults${qs}`);
  return vaults;
}

export async function getVault(id: number): Promise<VaultRow | null> {
  try {
    return await fetchJson<VaultRow>(`/v1/vaults/${id}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes('404')) return null;
    throw err;
  }
}

export async function getVaultDeposits(id: number, limit = 50): Promise<VaultActivityRow[]> {
  const { deposits } = await fetchJson<{ deposits: VaultActivityRow[] }>(
    `/v1/vaults/${id}/deposits?limit=${limit}`,
  );
  return deposits;
}

export async function getVaultWithdraws(id: number, limit = 50): Promise<VaultActivityRow[]> {
  const { withdraws } = await fetchJson<{ withdraws: VaultActivityRow[] }>(
    `/v1/vaults/${id}/withdraws?limit=${limit}`,
  );
  return withdraws;
}

export async function getVaultFeeClaims(id: number, limit = 50): Promise<VaultActivityRow[]> {
  const { feeClaims } = await fetchJson<{ feeClaims: VaultActivityRow[] }>(
    `/v1/vaults/${id}/fee-claims?limit=${limit}`,
  );
  return feeClaims;
}

export async function getVaultTrades(id: number, limit = 50): Promise<VaultTradeRow[]> {
  const { trades } = await fetchJson<{ trades: VaultTradeRow[] }>(
    `/v1/vaults/${id}/trades?limit=${limit}`,
  );
  return trades;
}
