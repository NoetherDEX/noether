// Referral dashboard types — mirror of @noether/sdk's ReferralApi shapes.

export interface ReferrerRow {
  referrer: string;
  code: string;
  createdAt: number;
  referredCount: number;
  totalVolumeGenerated: string;
  totalEarned: string;
  claimable: string;
  updatedAt: number;
}

export interface ReferralBindingRow {
  referee: string;
  referrer: string;
  code: string;
  boundAt: number;
  txHash: string;
}

export interface ReferralTradeRow {
  id: number;
  referee: string;
  referrer: string;
  originalFee: string;
  discount: string;
  payout: string;
  ledger: number;
  ts: number;
  txHash: string;
}

export interface ReferralClaimRow {
  id: number;
  referrer: string;
  amount: string;
  ledger: number;
  ts: number;
  txHash: string;
}

export interface ReferralMeResponse {
  self: ReferrerRow | null;
  binding: ReferralBindingRow | null;
}

export const REFERRAL_PRECISION = 10_000_000n;

export function fmtReferralUsdc(raw: string, dp = 2): string {
  const value = BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / REFERRAL_PRECISION;
  const frac = abs % REFERRAL_PRECISION;
  return `${negative ? '-' : ''}${whole}.${frac.toString().padStart(7, '0').slice(0, dp)}`;
}
