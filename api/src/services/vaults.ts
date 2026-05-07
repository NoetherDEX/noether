import type { Client } from '@libsql/client';

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

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(n?: number): number {
  return Math.min(MAX_LIMIT, Math.max(1, n ?? DEFAULT_LIMIT));
}

function toRow(row: Record<string, unknown>): VaultRow {
  return {
    id: Number(row.id),
    leader: String(row.leader),
    name: String(row.name),
    createdAt: Number(row.created_at),
    totalUsdc: String(row.total_usdc),
    circulatingShares: String(row.circulating_shares),
    hwmNav: String(row.hwm_nav),
    realizedPnl: String(row.realized_pnl),
    leaderShares: String(row.leader_shares),
    profitShareBps: Number(row.profit_share_bps),
    paused: Number(row.paused) === 1,
    updatedAt: Number(row.updated_at),
  };
}

export class VaultsService {
  constructor(private readonly db: Client) {}

  async list(opts?: { leader?: string; limit?: number }): Promise<VaultRow[]> {
    const limit = clampLimit(opts?.limit);
    try {
      const args: (string | number)[] = [];
      let where = '';
      if (opts?.leader) {
        where = 'WHERE leader = ?';
        args.push(opts.leader);
      }
      args.push(limit);
      const result = await this.db.execute({
        sql: `SELECT * FROM vaults ${where} ORDER BY created_at DESC LIMIT ?`,
        args,
      });
      return result.rows.map((r) => toRow(r as unknown as Record<string, unknown>));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('no such table')) return [];
      throw err;
    }
  }

  async get(id: number): Promise<VaultRow | null> {
    try {
      const result = await this.db.execute({
        sql: 'SELECT * FROM vaults WHERE id = ?',
        args: [id],
      });
      const row = result.rows[0];
      return row ? toRow(row as unknown as Record<string, unknown>) : null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('no such table')) return null;
      throw err;
    }
  }

  async deposits(vaultId: number, limit?: number): Promise<VaultActivityRow[]> {
    return this.activity('vault_deposits', 'depositor', vaultId, limit, true);
  }

  async withdraws(vaultId: number, limit?: number): Promise<VaultActivityRow[]> {
    return this.activity('vault_withdraws', 'depositor', vaultId, limit, true);
  }

  async feeClaims(vaultId: number, limit?: number): Promise<VaultActivityRow[]> {
    return this.activity('vault_fee_claims', 'leader', vaultId, limit, false);
  }

  private async activity(
    table: 'vault_deposits' | 'vault_withdraws' | 'vault_fee_claims',
    principalCol: string,
    vaultId: number,
    limit: number | undefined,
    hasShares: boolean,
  ): Promise<VaultActivityRow[]> {
    const cap = clampLimit(limit);
    try {
      const result = await this.db.execute({
        sql: `SELECT * FROM ${table} WHERE vault_id = ? ORDER BY ts DESC LIMIT ?`,
        args: [vaultId, cap],
      });
      return result.rows.map((r) => {
        const row = r as unknown as Record<string, unknown>;
        const amountKey =
          table === 'vault_deposits'
            ? 'amount'
            : table === 'vault_withdraws'
              ? 'usdc_out'
              : 'amount';
        const out: VaultActivityRow = {
          id: Number(row.id),
          vaultId: Number(row.vault_id),
          principal: String(row[principalCol]),
          amount: String(row[amountKey]),
          ledger: Number(row.ledger),
          ts: Number(row.ts),
          txHash: String(row.tx_hash),
        };
        if (hasShares && row.shares !== undefined && row.shares !== null) {
          out.shares = String(row.shares);
        }
        return out;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('no such table')) return [];
      throw err;
    }
  }
}
