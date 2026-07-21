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
  | VaultPausedEvent
  | VaultLeaderOpenEvent
  | VaultLeaderCloseEvent
  | VaultLeaderOrderEvent
  | VaultLeaderProtectiveEvent
  | VaultOrderReconciledEvent
  | VaultPositionReconciledEvent;

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

export interface VaultLeaderOpenEvent extends VaultEventEnvelope {
  topic: 'leader_open';
  leader: StellarAddress;
  positionId: bigint;
  collateral: bigint;
}

export interface VaultLeaderCloseEvent extends VaultEventEnvelope {
  topic: 'leader_close';
  leader: StellarAddress;
  positionId: bigint;
}

/** L1-30/L0-20: a leader placed or cancelled an entry order. */
export interface VaultLeaderOrderEvent extends VaultEventEnvelope {
  topic: 'leader_limit' | 'leader_cancel' | 'leader_stop_limit';
  leader: StellarAddress;
  orderId: bigint;
}

/** L1-30: a leader attached a protective order to a vault position. */
export interface VaultLeaderProtectiveEvent extends VaultEventEnvelope {
  topic: 'leader_sl' | 'leader_tp' | 'leader_trail';
  leader: StellarAddress;
  orderId: bigint;
  positionId: bigint;
}

/** L0-20: an executed/cancelled order was reconciled back into its vault
 * (positionId 0 = cancelled/expired refund; credited = USDC returned). */
export interface VaultOrderReconciledEvent extends VaultEventEnvelope {
  topic: 'order_reconciled';
  orderId: bigint;
  positionId: bigint;
  credited: bigint;
}

/** L1-30: a market-side full close/liquidation of a vault position was
 * reconciled — `proceeds` credited to the vault's total_usdc. */
export interface VaultPositionReconciledEvent extends VaultEventEnvelope {
  topic: 'position_reconciled';
  positionId: bigint;
  proceeds: bigint;
}
