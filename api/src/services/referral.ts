import { isMissingTable, type Db } from '@noether/db';

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

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(n?: number): number {
  return Math.min(MAX_LIMIT, Math.max(1, n ?? DEFAULT_LIMIT));
}

function toReferrerRow(row: Record<string, unknown>): ReferrerRow {
  return {
    referrer: String(row.referrer),
    code: String(row.code),
    createdAt: Number(row.created_at),
    referredCount: Number(row.referred_count),
    totalVolumeGenerated: String(row.total_volume_generated),
    totalEarned: String(row.total_earned),
    claimable: String(row.claimable),
    updatedAt: Number(row.updated_at),
  };
}

function toBindingRow(row: Record<string, unknown>): ReferralBindingRow {
  return {
    referee: String(row.referee),
    referrer: String(row.referrer),
    code: String(row.code),
    boundAt: Number(row.bound_at),
    txHash: String(row.tx_hash),
  };
}

function toTradeRow(row: Record<string, unknown>): ReferralTradeRow {
  return {
    id: Number(row.id),
    referee: String(row.referee),
    referrer: String(row.referrer),
    originalFee: String(row.original_fee),
    discount: String(row.discount),
    payout: String(row.payout),
    ledger: Number(row.ledger),
    ts: Number(row.ts),
    txHash: String(row.tx_hash),
  };
}

function toClaimRow(row: Record<string, unknown>): ReferralClaimRow {
  return {
    id: Number(row.id),
    referrer: String(row.referrer),
    amount: String(row.amount),
    ledger: Number(row.ledger),
    ts: Number(row.ts),
    txHash: String(row.tx_hash),
  };
}

export class ReferralReadService {
  constructor(private readonly db: Db) {}

  async lookupCode(code: string): Promise<ReferrerRow | null> {
    try {
      const result = await this.db.execute({
        sql: 'SELECT * FROM referrers WHERE code = ?',
        args: [code],
      });
      const row = result.rows[0];
      return row ? toReferrerRow(row as unknown as Record<string, unknown>) : null;
    } catch (err) {
      if (isMissingTable(err)) return null;
      throw err;
    }
  }

  async getReferrerByAddress(address: string): Promise<ReferrerRow | null> {
    try {
      const result = await this.db.execute({
        sql: 'SELECT * FROM referrers WHERE referrer = ?',
        args: [address],
      });
      const row = result.rows[0];
      return row ? toReferrerRow(row as unknown as Record<string, unknown>) : null;
    } catch (err) {
      if (isMissingTable(err)) return null;
      throw err;
    }
  }

  async getBindingForReferee(address: string): Promise<ReferralBindingRow | null> {
    try {
      const result = await this.db.execute({
        sql: 'SELECT * FROM referral_bindings WHERE referee = ?',
        args: [address],
      });
      const row = result.rows[0];
      return row ? toBindingRow(row as unknown as Record<string, unknown>) : null;
    } catch (err) {
      if (isMissingTable(err)) return null;
      throw err;
    }
  }

  async tradesForReferrer(referrer: string, limit?: number): Promise<ReferralTradeRow[]> {
    return this.queryActivity<ReferralTradeRow>(
      'SELECT * FROM referral_trades WHERE referrer = ? ORDER BY ts DESC LIMIT ?',
      [referrer, clampLimit(limit)],
      toTradeRow,
    );
  }

  async claimsForReferrer(referrer: string, limit?: number): Promise<ReferralClaimRow[]> {
    return this.queryActivity<ReferralClaimRow>(
      'SELECT * FROM referral_claims WHERE referrer = ? ORDER BY ts DESC LIMIT ?',
      [referrer, clampLimit(limit)],
      toClaimRow,
    );
  }

  private async queryActivity<T>(
    sql: string,
    args: (string | number)[],
    map: (row: Record<string, unknown>) => T,
  ): Promise<T[]> {
    try {
      const result = await this.db.execute({ sql, args });
      return result.rows.map((r) => map(r as unknown as Record<string, unknown>));
    } catch (err) {
      if (isMissingTable(err)) return [];
      throw err;
    }
  }

}
