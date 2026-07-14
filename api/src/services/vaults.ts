import { isMissingTable, type Db } from '@noether/db';
import { TtlCache } from './cache.js';

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
  /** Yield in basis points, SIGNED (losing vaults are negative). Annualised
   *  only when the vault is ≥7 days old; younger vaults report the raw
   *  since-inception return (see apyKind) — annualising a days-old track
   *  record fabricates triple-digit APYs. */
  apyBps?: number;
  /** 'annualized' (≥7d old) or 'inception' (younger — apyBps is the raw
   *  since-inception return, NOT an annual rate). */
  apyKind?: 'annualized' | 'inception';
  /**
   * Sum of pnl from every leader_close in vault_trades (7-dec USDC,
   * signed). This is the "lifetime PnL from closed trades returned
   * to the pool" number — different from realizedPnl, which is the
   * contract's counter for leader fee-share payouts.
   */
  closedTradePnl?: string;
}

export interface VaultTradeRow {
  id: number;
  vaultId: number;
  positionId: string;
  action: 'open' | 'close';
  leader: string;
  collateral: string;
  /**
   * Settled PnL on close rows (7-dec USDC, signed). Sourced from the
   * matching position_closed event in the same tx. NULL for open rows
   * and for close rows older than the indexer started populating it
   * (those rows are backfilled by migration 011 where possible).
   */
  pnl?: string | null;
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
const AGG_TTL_MS = 10_000;

/** Cursor + limit for the activity/trade history endpoints. */
export interface HistoryOpts {
  limit?: number;
  /** Only rows strictly older than this ts (unix sec). */
  beforeTs?: number;
}

export interface VaultAggregates {
  depositorCount: number;
  openPositions: number;
  tradeCount: number;
  drawdownBps: number;
  apyBps: number;
  apyKind: 'annualized' | 'inception';
  closedTradePnl: string;
}

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
  // Coalesce the per-vault aggregate fan-out (audit A-7) so a burst of
  // /v1/vaults requests doesn't re-run the N+1 round-trips every time.
  private readonly aggCache = new TtlCache<VaultAggregates>(AGG_TTL_MS);

  constructor(private readonly db: Db) {}

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
      if (isMissingTable(err)) return [];
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
      if (isMissingTable(err)) return null;
      throw err;
    }
  }

  async deposits(vaultId: number, opts: HistoryOpts = {}): Promise<VaultActivityRow[]> {
    return this.activity('vault_deposits', 'depositor', vaultId, opts, true);
  }

  async withdraws(vaultId: number, opts: HistoryOpts = {}): Promise<VaultActivityRow[]> {
    return this.activity('vault_withdraws', 'depositor', vaultId, opts, true);
  }

  async feeClaims(vaultId: number, opts: HistoryOpts = {}): Promise<VaultActivityRow[]> {
    return this.activity('vault_fee_claims', 'leader', vaultId, opts, false);
  }

  async trades(vaultId: number, opts: HistoryOpts = {}): Promise<VaultTradeRow[]> {
    const cap = clampLimit(opts.limit);
    const cursor = opts.beforeTs !== undefined ? 'AND ts < ?' : '';
    const args: (string | number)[] =
      opts.beforeTs !== undefined ? [vaultId, opts.beforeTs, cap] : [vaultId, cap];
    try {
      const result = await this.db.execute({
        sql: `SELECT * FROM vault_trades WHERE vault_id = ? ${cursor} ORDER BY ts DESC LIMIT ?`,
        args,
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
          pnl: row.pnl == null ? null : String(row.pnl),
          ledger: Number(row.ledger),
          ts: Number(row.ts),
          txHash: String(row.tx_hash),
        };
      });
    } catch (err) {
      if (isMissingTable(err)) return [];
      throw err;
    }
  }

  /**
   * Aggregate stats for a single vault — used to enrich both the
   * marketplace card and the detail page without N+1 round-trips.
   * Returns undefined fields if the underlying table doesn't exist yet
   * (e.g. older indexer that hasn't run migration 005).
   */
  async aggregates(vaultId: number, vault?: VaultRow): Promise<VaultAggregates> {
    return this.aggCache.getOrLoad(String(vaultId), () => this.computeAggregates(vaultId, vault));
  }

  private async computeAggregates(vaultId: number, vault?: VaultRow): Promise<VaultAggregates> {
    let depositorCount = 0;
    let openPositions = 0;
    let tradeCount = 0;
    let closedTradePnl = '0';
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
            COALESCE(SUM(CASE WHEN action='close' THEN 1 ELSE 0 END), 0) AS closes,
            COALESCE(SUM(CASE WHEN action='close' AND pnl IS NOT NULL THEN pnl ELSE 0 END), 0) AS pnl_sum
          FROM vault_trades WHERE vault_id = ?
        `,
        args: [vaultId],
      });
      const r = (tr.rows[0] ?? {}) as {
        opens?: number | bigint;
        closes?: number | bigint;
        pnl_sum?: number | bigint | string;
      };
      const opens = Number(r.opens ?? 0);
      const closes = Number(r.closes ?? 0);
      tradeCount = opens;
      openPositions = Math.max(0, opens - closes);
      closedTradePnl = String(r.pnl_sum ?? 0);
    } catch { /* table missing or pnl column absent (pre-migration-011) */ }

    const v = vault ?? (await this.get(vaultId));
    let drawdownBps = 0;
    let apyBps = 0;
    let apyKind: 'annualized' | 'inception' = 'annualized';
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
      // APY uses closed-trade PnL (the actual yield the pool earned),
      // not the contract's realized_pnl (which only counts leader
      // fee-share payouts and would understate APY by a large margin).
      const lifetime = BigInt(closedTradePnl);
      const nowSec = Math.floor(Date.now() / 1000);
      const days = Math.max(1, (nowSec - v.createdAt) / 86_400);
      if (total > 0n && lifetime !== 0n) {
        // SIGNED: a losing vault must show a negative yield, never a
        // neutral 0.00% (the primary allocation metric can't be a number
        // that mathematically cannot go negative).
        const lifeBps = Number((lifetime * 10_000n) / total);
        if (days >= 7) {
          apyBps = Math.round((lifeBps * 365) / days);
        } else {
          // Too young to annualise honestly — report the raw
          // since-inception return and flag it via apyKind.
          apyBps = lifeBps;
          apyKind = 'inception';
        }
      } else if (days < 7) {
        apyKind = 'inception';
      }
    }
    return { depositorCount, openPositions, tradeCount, drawdownBps, apyBps, apyKind, closedTradePnl };
  }

  private async activity(
    table: 'vault_deposits' | 'vault_withdraws' | 'vault_fee_claims',
    principalCol: string,
    vaultId: number,
    opts: HistoryOpts,
    hasShares: boolean,
  ): Promise<VaultActivityRow[]> {
    const cap = clampLimit(opts.limit);
    const cursor = opts.beforeTs !== undefined ? 'AND ts < ?' : '';
    const args: (string | number)[] =
      opts.beforeTs !== undefined ? [vaultId, opts.beforeTs, cap] : [vaultId, cap];
    try {
      const result = await this.db.execute({
        sql: `SELECT * FROM ${table} WHERE vault_id = ? ${cursor} ORDER BY ts DESC LIMIT ?`,
        args,
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
      if (isMissingTable(err)) return [];
      throw err;
    }
  }
}
