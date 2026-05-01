// Referral types are introduced in Phase 11.
// Placeholder so consumers can import @noether/types/referral from day one.

import type { StellarAddress } from './common.js';

export interface ReferralInfo {
  code: string;
  referrer: StellarAddress;
  createdAt: number;
  referredCount: number;
  totalVolumeGenerated: bigint;
  totalEarned: bigint;
  claimable: bigint;
}
