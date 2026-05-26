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
  /** Distinct depositor count from vault_deposits. */
  depositorCount?: number;
  /** Open positions = leader_open − leader_close in vault_trades. */
  openPositions?: number;
  /** Total trade count = leader_open count. */
  tradeCount?: number;
  /** Drawdown in basis points = (hwm - nav) / hwm × 10000, floor 0. */
  drawdownBps?: number;
  /** Annualised yield in basis points (very simple: realizedPnl / TVL × 365 / days). */
  apyBps?: number;
}

export interface VaultTradeRow {
  id: number;
  vaultId: number;
  positionId: string;
  action: 'open' | 'close';
  leader: string;
  collateral: string;
  ledger: number;
  ts: number;
  txHash: string;
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

  async trades(vaultId: number, limit?: number): Promise<VaultTradeRow[]> {
    const cap = clampLimit(limit);
    try {
      const result = await this.db.execute({
        sql: 'SELECT * FROM vault_trades WHERE vault_id = ? ORDER BY ts DESC LIMIT ?',
        args: [vaultId, cap],
      });
      return result.rows.map((r) => {
        const row = r as unknown as Record<string, unknown>;
        return {
          id: Number(row.id),
          vaultId: Number(row.vault_id),
          positionId: String(row.position_id),
          action: String(row.action) as 'open' | 'close',
          leader: String(row.leader),
          collateral: String(row.collateral),
          ledger: Number(row.ledger),
          ts: Number(row.ts),
          txHash: String(row.tx_hash),
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('no such table')) return [];
      throw err;
    }
  }

  /**
   * Aggregate stats for a single vault — used to enrich both the
   * marketplace card and the detail page without N+1 round-trips.
   * Returns undefined fields if the underlying table doesn't exist yet
   * (e.g. older indexer that hasn't run migration 005).
   */
  async aggregates(vaultId: number, vault?: VaultRow): Promise<{
    depositorCount: number;
    openPositions: number;
    tradeCount: number;
    drawdownBps: number;
    apyBps: number;
  }> {
    let depositorCount = 0;
    let openPositions = 0;
    let tradeCount = 0;
    try {
      const dep = await this.db.execute({
        sql: 'SELECT COUNT(DISTINCT depositor) AS n FROM vault_deposits WHERE vault_id = ?',
        args: [vaultId],
      });
      depositorCount = Number((dep.rows[0] as { n?: number | bigint } | undefined)?.n ?? 0);
    } catch { /* table missing — leave 0 */ }
    try {
      const tr = await this.db.execute({
        sql: `
          SELECT
            COALESCE(SUM(CASE WHEN action='open' THEN 1 ELSE 0 END), 0) AS opens,
            COALESCE(SUM(CASE WHEN action='close' THEN 1 ELSE 0 END), 0) AS closes
          FROM vault_trades WHERE vault_id = ?
        `,
        args: [vaultId],
      });
      const r = (tr.rows[0] ?? {}) as { opens?: number | bigint; closes?: number | bigint };
      const opens = Number(r.opens ?? 0);
      const closes = Number(r.closes ?? 0);
      tradeCount = opens;
      openPositions = Math.max(0, opens - closes);
    } catch { /* table missing */ }

    const v = vault ?? (await this.get(vaultId));
    let drawdownBps = 0;
    let apyBps = 0;
    if (v) {
      const total = BigInt(v.totalUsdc);
      const shares = BigInt(v.circulatingShares);
      const hwm = BigInt(v.hwmNav);
      // current NAV (PRECISION-scaled, denom 10^7)
      const PRECISION = 10_000_000n;
      const nav = shares === 0n ? PRECISION : (total * PRECISION) / shares;
      if (hwm > nav && hwm > 0n) {
        drawdownBps = Number(((hwm - nav) * 10_000n) / hwm);
      }
      // simple APY = realizedPnl / totalUsdc * 365 / days_active
      const realized = BigInt(v.realizedPnl);
      const nowSec = Math.floor(Date.now() / 1000);
      const days = Math.max(1, (nowSec - v.createdAt) / 86_400);
      if (total > 0n && realized > 0n) {
        // realizedPnl / total * 10000 → bps for the lifetime, scale to year
        const lifeBps = Number((realized * 10_000n) / total);
        apyBps = Math.round((lifeBps * 365) / days);
      }
    }
    return { depositorCount, openPositions, tradeCount, drawdownBps, apyBps };
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
