// Vault types — surface that vault_factory contract events / view fns
// produce, mirrored on the off-chain side. Lives in @noether/types so
// the api, indexer, sdk-ts, and web frontend agree on the shape.

import type { StellarAddress } from './common.js';

/** Per-vault row written to events_raw projections + returned by `getVault`. */
export interface VaultInfo {
  id: number;
  leader: StellarAddress;
  name: string;
  /** Unix seconds. */
  createdAt: number;
  /** Total USDC parked in the vault (deposits + realized PnL - withdrawals). */
  totalUsdc: bigint;
  /** Total share supply outstanding across all depositors. */
  circulatingShares: bigint;
  /** High-water mark — NAV per share at the last claim_leader_fees call (PRECISION-scaled). */
  hwmNav: bigint;
  /** Realized PnL paid out to the leader (USDC). */
  realizedPnl: bigint;
  /** Leader's own share balance (5% invariant target). */
  leaderShares: bigint;
  /** Leader profit share in basis points (default 1000 = 10%). */
  profitShareBps: number;
  /** When true, deposits/withdrawals are blocked. */
  paused: boolean;
}

/** Time-series snapshot the indexer derives per (vault_id, ts). */
export interface VaultSnapshot {
  vaultId: number;
  ts: number;
  tvl: bigint;
  aum: bigint;
  /** NAV per share (PRECISION-scaled). */
  nav: bigint;
  openPositions: number;
  /** HWM at this snapshot. */
  hwm: bigint;
}

/** Decoded event payloads emitted by vault_factory. */
export type VaultEvent =
  | VaultCreatedEvent
  | VaultDepositEvent
  | VaultWithdrawEvent
  | VaultFeesClaimedEvent
  | VaultPausedEvent;

export interface VaultEventEnvelope {
  topic: string;
  vaultId: number;
  ledger: number;
  ledgerCloseTs: number;
  txHash: string;
}

export interface VaultCreatedEvent extends VaultEventEnvelope {
  topic: 'vault_created';
  leader: StellarAddress;
  name: string;
}

export interface VaultDepositEvent extends VaultEventEnvelope {
  topic: 'deposit';
  depositor: StellarAddress;
  amount: bigint;
  shares: bigint;
}

export interface VaultWithdrawEvent extends VaultEventEnvelope {
  topic: 'withdraw';
  depositor: StellarAddress;
  shares: bigint;
  usdcOut: bigint;
}

export interface VaultFeesClaimedEvent extends VaultEventEnvelope {
  topic: 'fees_claimed';
  leader: StellarAddress;
  owed: bigint;
  newNav: bigint;
}

export interface VaultPausedEvent extends VaultEventEnvelope {
  topic: 'paused' | 'unpaused' | 'admin_paused' | 'admin_unpaused';
}
