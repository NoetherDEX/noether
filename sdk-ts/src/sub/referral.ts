import type { Credentials, Transport } from '../transport.js';

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
  /** The owner's row in the referrers table (null if they don't have a code). */
  self: ReferrerRow | null;
  /** The referrer the owner is bound to as a referee (null if unbound). */
  binding: ReferralBindingRow | null;
}

export class ReferralApi {
  constructor(private readonly transport: Transport, private readonly credentials: Credentials | null) {}

  /** Public — resolve a code to its referrer row. Returns null on 404. */
  async lookupCode(code: string): Promise<ReferrerRow | null> {
    try {
      return await this.transport.request<ReferrerRow>({
        path: '/v1/referral/lookup',
        query: { code },
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'NotFoundError') return null;
      throw err;
    }
  }

  /**
   * Public — referral state for any address (same shape as `me()`).
   * Returns null if the address has never registered a code.
   */
  async info(address: string): Promise<ReferralMeResponse | null> {
    try {
      return await this.transport.request<ReferralMeResponse>({
        path: '/v1/referral/info',
        query: { address },
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'NotFoundError') return null;
      throw err;
    }
  }

  /** Authed — both ends of the relationship for the authenticated owner. */
  async me(): Promise<ReferralMeResponse> {
    this.requireAuth();
    return this.transport.request<ReferralMeResponse>({
      path: '/v1/referral/me',
      credentials: this.credentials,
    });
  }

  /** Authed — trades the owner has earned referral fees on. */
  async trades(opts: { limit?: number } = {}): Promise<ReferralTradeRow[]> {
    this.requireAuth();
    const res = await this.transport.request<{ trades: ReferralTradeRow[] }>({
      path: '/v1/referral/me/trades',
      query: { limit: opts.limit },
      credentials: this.credentials,
    });
    return res.trades;
  }

  /** Authed — claim history for the owner. */
  async claims(opts: { limit?: number } = {}): Promise<ReferralClaimRow[]> {
    this.requireAuth();
    const res = await this.transport.request<{ claims: ReferralClaimRow[] }>({
      path: '/v1/referral/me/claims',
      query: { limit: opts.limit },
      credentials: this.credentials,
    });
    return res.claims;
  }

  private requireAuth(): void {
    if (!this.credentials) {
      throw new Error('referral.me / trades / claims require an authenticated client');
    }
  }
}
