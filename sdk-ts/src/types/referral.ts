// Referral types — surface that the referral contract events / view
// fns produce. Lives in @noether/types so api, indexer, sdk-ts, and
// the web frontend share one shape.

import type { StellarAddress } from './common.js';

/** Per-referrer row, mirrors the contract's ReferralInfo struct. */
export interface ReferralInfo {
  code: string;
  referrer: StellarAddress;
  /** Unix seconds. */
  createdAt: number;
  referredCount: number;
  totalVolumeGenerated: bigint;
  totalEarned: bigint;
  claimable: bigint;
}

/** Decoded event payloads emitted by the referral contract. */
export type ReferralEvent =
  | ReferralCodeCreatedEvent
  | ReferralReferrerSetEvent
  | ReferralTradeRecordedEvent
  | ReferralClaimedEvent;

interface ReferralEventEnvelope {
  topic: string;
  ledger: number;
  ledgerCloseTs: number;
  txHash: string;
}

export interface ReferralCodeCreatedEvent extends ReferralEventEnvelope {
  topic: 'code_created';
  referrer: StellarAddress;
  code: string;
}

export interface ReferralReferrerSetEvent extends ReferralEventEnvelope {
  topic: 'referrer_set';
  referee: StellarAddress;
  referrer: StellarAddress;
  code: string;
}

export interface ReferralTradeRecordedEvent extends ReferralEventEnvelope {
  topic: 'trade_recorded';
  referee: StellarAddress;
  referrer: StellarAddress;
  originalFee: bigint;
  discount: bigint;
  payout: bigint;
}

export interface ReferralClaimedEvent extends ReferralEventEnvelope {
  topic: 'claimed';
  referrer: StellarAddress;
  amount: bigint;
}

/** Configuration tunables exposed by the contract's get_config view. */
export interface ReferralConfig {
  discountBps: number;
  referrerShareBps: number;
  minCodeVolume: bigint;
}
