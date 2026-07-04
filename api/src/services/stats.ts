import type { Client, Row } from '@libsql/client';
import { SUPPORTED_ASSETS } from '@noether/shared';
import { TtlCache } from './cache.js';

const DAY_SEC = 86_400;
export const VOLUME_WINDOW_SEC = 14 * DAY_SEC;

const STATS_TTL_MS = 5_000;
const DEFAULT_TRADES_LIMIT = 50;
const MAX_TRADES_LIMIT = 200;
const DEFAULT_LEADERBOARD_LIMIT = 50;
const MAX_LEADERBOARD_LIMIT = 200;

export type LeaderboardSort = 'pnl' | 'volume';

export interface LeaderboardEntry {
  trader: string;
  /** Lifetime realized PnL, 7-dec USDC (sum of position_closed pnl). */
  pnl: string;
  /** Lifetime traded notional, 7-dec (opens + matched closes). */
  volume: string;
}

export interface AssetStats {
  asset: string;
  openInterestLong: string;
  openInterestShort: string;
  openInterestNet: string;
  openPositions: number;
  volume24h: string;
}

export interface RealizedTradeRow {
  positionId: number;
  trader: string;
  kind: 'close' | 'liquidation';
  asset: string | null;
  direction: number | null;
  size: string | null;
  entryPrice: string | null;
  closePrice: string | null;
  pnl: string | null;
  ledger: number;
  ts: number;
  txHash: string;
}

/**
 * Read-side aggregates over the indexer's events_raw log and positions
 * projection: trailing traded notional (fee-tier preview), per-asset open
 * interest, and realized trade history. position_closed / liquidated
 * payloads carry no size or asset, so realized legs join back to their
 * position_opened event by positionId.
 */
export class StatsService {
  private readonly cache = new TtlCache<AssetStats[]>(STATS_TTL_MS);
  private readonly lbCache = new TtlCache<LeaderboardEntry[]>(STATS_TTL_MS);

  constructor(private readonly db: Client) {}

  /**
   * Trailing 14-day traded notional for one wallet (i128, 7-dec USDC).
   * Mirrors the market contract's rolling VolumeRecord: opens and closes
   * each record the position's full size; liquidations record nothing.
   */
  async traderVolume14d(address: string, now = nowSec()): Promise<bigint> {
    const since = now - VOLUME_WINDOW_SEC;
    try {
      const opens = await this.db.execute({
        sql: `
          SELECT json_extract(payload_json, '$.size') AS size
          FROM events_raw
          WHERE topic = 'position_opened'
            AND json_extract(payload_json, '$.trader') = ?
            AND ledger_close_ts >= ?
        `,
        args: [address, since],
      });
      const closes = await this.db.execute({
        sql: `
          SELECT json_extract(o.payload_json, '$.size') AS size
          FROM events_raw c
          JOIN events_raw o
            ON o.topic = 'position_opened'
           AND json_extract(o.payload_json, '$.positionId') = json_extract(c.payload_json, '$.positionId')
          WHERE c.topic = 'position_closed'
            AND json_extract(c.payload_json, '$.trader') = ?
            AND c.ledger_close_ts >= ?
        `,
        args: [address, since],
      });
      return sumSizes(opens.rows) + sumSizes(closes.rows);
    } catch (err) {
      if (isMissingTable(err)) return 0n;
      throw err;
    }
  }

  async marketStats(): Promise<AssetStats[]> {
    return this.cache.getOrLoad('market_stats', () => this.computeMarketStats());
  }

  private async computeMarketStats(now = nowSec()): Promise<AssetStats[]> {
    const acc = new Map<string, { long: bigint; short: bigint; count: number; volume: bigint }>();
    const bucket = (asset: string) => {
      let b = acc.get(asset);
      if (!b) {
        b = { long: 0n, short: 0n, count: 0, volume: 0n };
        acc.set(asset, b);
      }
      return b;
    };
    for (const a of SUPPORTED_ASSETS) bucket(a.symbol);

    try {
      const open = await this.db.execute('SELECT asset, direction, size FROM positions');
      for (const row of open.rows) {
        const b = bucket(String(row.asset));
        const size = BigInt(String(row.size));
        if (Number(row.direction) === 0) b.long += size;
        else b.short += size;
        b.count += 1;
      }
    } catch (err) {
      if (!isMissingTable(err)) throw err;
    }

    const since = now - DAY_SEC;
    try {
      const opens = await this.db.execute({
        sql: `
          SELECT json_extract(payload_json, '$.asset') AS asset,
                 json_extract(payload_json, '$.size') AS size
          FROM events_raw
          WHERE topic = 'position_opened'
            AND ledger_close_ts >= ?
        `,
        args: [since],
      });
      for (const row of opens.rows) bucket(String(row.asset)).volume += BigInt(String(row.size));
      const realized = await this.db.execute({
        sql: `
          SELECT json_extract(o.payload_json, '$.asset') AS asset,
                 json_extract(o.payload_json, '$.size') AS size
          FROM events_raw c
          JOIN events_raw o
            ON o.topic = 'position_opened'
           AND json_extract(o.payload_json, '$.positionId') = json_extract(c.payload_json, '$.positionId')
          WHERE c.topic IN ('position_closed', 'position_liquidated')
            AND c.ledger_close_ts >= ?
        `,
        args: [since],
      });
      for (const row of realized.rows) bucket(String(row.asset)).volume += BigInt(String(row.size));
    } catch (err) {
      if (!isMissingTable(err)) throw err;
    }

    return [...acc.entries()].map(([asset, b]) => ({
      asset,
      openInterestLong: b.long.toString(),
      openInterestShort: b.short.toString(),
      openInterestNet: (b.long - b.short).toString(),
      openPositions: b.count,
      volume24h: b.volume.toString(),
    }));
  }

  async recentTrades(
    opts: { trader?: string; asset?: string; beforeTs?: number; limit?: number } = {},
  ): Promise<RealizedTradeRow[]> {
    const limit = Math.min(MAX_TRADES_LIMIT, Math.max(1, opts.limit ?? DEFAULT_TRADES_LIMIT));
    const conditions = [`c.topic IN ('position_closed', 'position_liquidated')`];
    const args: (string | number)[] = [];
    if (opts.trader) {
      conditions.push(`json_extract(c.payload_json, '$.trader') = ?`);
      args.push(opts.trader);
    }
    if (opts.asset) {
      conditions.push(`json_extract(o.payload_json, '$.asset') = ?`);
      args.push(opts.asset);
    }
    if (opts.beforeTs !== undefined) {
      conditions.push(`c.ledger_close_ts < ?`);
      args.push(opts.beforeTs);
    }
    try {
      const result = await this.db.execute({
        sql: `
          SELECT c.topic AS topic, c.ledger AS ledger, c.ledger_close_ts AS ts,
                 c.tx_hash AS tx_hash, c.payload_json AS payload_json,
                 o.payload_json AS open_payload_json
          FROM events_raw c
          LEFT JOIN events_raw o
            ON o.topic = 'position_opened'
           AND json_extract(o.payload_json, '$.positionId') = json_extract(c.payload_json, '$.positionId')
          WHERE ${conditions.join(' AND ')}
          ORDER BY c.ledger DESC, c.event_id DESC
          LIMIT ?
        `,
        args: [...args, limit],
      });
      return result.rows.map(mapRealizedRow);
    } catch (err) {
      if (isMissingTable(err)) return [];
      throw err;
    }
  }

  /**
   * Trader leaderboard from the indexer projections — the durable
   * replacement for the web cron that re-scanned Horizon (audit W-5 / P4-26).
   * Ranks by lifetime realized PnL (sum of position_closed pnl) or by traded
   * notional (opens + matched closes, mirroring the fee-tier volume model;
   * liquidations excluded). Sums are folded in BigInt so large i128 totals
   * stay exact regardless of libsql int mode. Cached briefly to absorb
   * anonymous polling.
   */
  async leaderboard(
    opts: { sort?: LeaderboardSort; limit?: number } = {},
  ): Promise<LeaderboardEntry[]> {
    const sort: LeaderboardSort = opts.sort === 'volume' ? 'volume' : 'pnl';
    const limit = Math.min(
      MAX_LEADERBOARD_LIMIT,
      Math.max(1, opts.limit ?? DEFAULT_LEADERBOARD_LIMIT),
    );
    return this.lbCache.getOrLoad(`${sort}:${limit}`, () => this.computeLeaderboard(sort, limit));
  }

  private async computeLeaderboard(sort: LeaderboardSort, limit: number): Promise<LeaderboardEntry[]> {
    const board = new Map<string, { pnl: bigint; volume: bigint }>();
    const bucket = (trader: string) => {
      let b = board.get(trader);
      if (!b) {
        b = { pnl: 0n, volume: 0n };
        board.set(trader, b);
      }
      return b;
    };

    try {
      const pnl = await this.db.execute(`
        SELECT json_extract(payload_json, '$.trader') AS trader,
               json_extract(payload_json, '$.pnl') AS pnl
        FROM events_raw
        WHERE topic = 'position_closed'
      `);
      for (const row of pnl.rows) {
        const trader = row.trader == null ? '' : String(row.trader);
        if (trader) bucket(trader).pnl += toBigInt(row.pnl);
      }
      const opens = await this.db.execute(`
        SELECT json_extract(payload_json, '$.trader') AS trader,
               json_extract(payload_json, '$.size') AS size
        FROM events_raw
        WHERE topic = 'position_opened'
      `);
      for (const row of opens.rows) {
        const trader = row.trader == null ? '' : String(row.trader);
        if (trader) bucket(trader).volume += toBigInt(row.size);
      }
      const closes = await this.db.execute(`
        SELECT json_extract(c.payload_json, '$.trader') AS trader,
               json_extract(o.payload_json, '$.size') AS size
        FROM events_raw c
        JOIN events_raw o
          ON o.topic = 'position_opened'
         AND json_extract(o.payload_json, '$.positionId') = json_extract(c.payload_json, '$.positionId')
        WHERE c.topic = 'position_closed'
      `);
      for (const row of closes.rows) {
        const trader = row.trader == null ? '' : String(row.trader);
        if (trader) bucket(trader).volume += toBigInt(row.size);
      }
    } catch (err) {
      if (isMissingTable(err)) return [];
      throw err;
    }

    const entries: LeaderboardEntry[] = [...board.entries()].map(([trader, b]) => ({
      trader,
      pnl: b.pnl.toString(),
      volume: b.volume.toString(),
    }));
    entries.sort((a, b) => {
      const av = sort === 'volume' ? BigInt(a.volume) : BigInt(a.pnl);
      const bv = sort === 'volume' ? BigInt(b.volume) : BigInt(b.pnl);
      return bv > av ? 1 : bv < av ? -1 : 0;
    });
    return entries.slice(0, limit);
  }
}

function mapRealizedRow(row: Row): RealizedTradeRow {
  const payload = JSON.parse(String(row.payload_json)) as {
    positionId?: number;
    trader?: string;
    pnl?: string;
    closePrice?: string;
  };
  const open =
    row.open_payload_json == null
      ? null
      : (JSON.parse(String(row.open_payload_json)) as {
          asset?: string;
          direction?: number;
          size?: string;
          entryPrice?: string;
        });
  const kind = String(row.topic) === 'position_liquidated' ? 'liquidation' : 'close';
  return {
    positionId: Number(payload.positionId ?? 0),
    trader: String(payload.trader ?? ''),
    kind,
    asset: open?.asset ?? null,
    direction: open?.direction ?? null,
    size: open?.size ?? null,
    entryPrice: open?.entryPrice ?? null,
    closePrice: payload.closePrice ?? null,
    pnl: kind === 'close' ? (payload.pnl ?? null) : null,
    ledger: Number(row.ledger),
    ts: Number(row.ts),
    txHash: String(row.tx_hash),
  };
}

function sumSizes(rows: Row[]): bigint {
  let total = 0n;
  for (const row of rows) total += BigInt(String(row.size ?? 0));
  return total;
}

function toBigInt(value: unknown): bigint {
  if (value == null) return 0n;
  try {
    return BigInt(String(value));
  } catch {
    return 0n;
  }
}

function isMissingTable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('no such table');
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
