// Vault types are introduced in Phase 10 (vault factory).
// Placeholder so consumers can import @noether/types/vault from day one.

import type { StellarAddress } from './common.js';

export interface VaultInfo {
  id: number;
  leader: StellarAddress;
  name: string;
  createdAt: number;
  totalDeposits: bigint;
  circulatingShares: bigint;
  hwm: bigint;
  realizedPnl: bigint;
  leaderOwnShares: bigint;
  profitShareBps: number;
  paused: boolean;
}

export interface VaultSnapshot {
  vaultId: number;
  ts: number;
  tvl: bigint;
  aum: bigint;
  nav: bigint;
  openPositions: number;
  hwm: bigint;
}
