import { isMissingTable, type Db, type Row } from '@noether/db';
import { SUPPORTED_ASSETS } from '@noether/shared';
import { TtlCache } from './cache.js';

const DAY_SEC = 86_400;
export const VOLUME_WINDOW_SEC = 14 * DAY_SEC;

const STATS_TTL_MS = 5_000;
const DEFAULT_TRADES_LIMIT = 50;
const MAX_TRADES_LIMIT = 200;
const DEFAULT_ORDERS_LIMIT = 50;
const MAX_ORDERS_LIMIT = 200;
const DEFAULT_LEADERBOARD_LIMIT = 50;
const MAX_LEADERBOARD_LIMIT = 200;
const DEFAULT_CANDLES_LIMIT = 500;
const MAX_CANDLES_LIMIT = 1000;
const PRICE_SCALE = 10_000_000;

export type LeaderboardSort = 'pnl' | 'volume';

export interface LeaderboardEntry {
  trader: string;
  /** Realized PnL, 7-dec USDC (live market + legacy baseline). */
  pnl: string;
  /** Traded notional, 7-dec (opens + matched closes, + legacy baseline). */
  volume: string;
  /** Trade count (position_opened rows, + legacy baseline). */
  trades: number;
  /** Liquidation count (full/partial/cross, + legacy baseline). */
  liqCount: number;
}

export interface LeaderboardBoard {
  /** poll_cursor.updated_at (unix seconds) — when the index last advanced. */
  updatedAt: number | null;
  leaders: LeaderboardEntry[];
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
  /** Null for account-level rows (cross_liquidation carries no position id). */
  positionId: number | null;
  trader: string;
  kind: 'open' | 'close' | 'liquidation' | 'cross_liquidation';
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

export type OrderEventStatus = 'open' | 'executed' | 'cancelled';

export interface OrderEventRow {
  orderId: number;
  trader: string;
  /** 7-dec trigger price as emitted by order_placed. */
  triggerPrice: string;
  status: OrderEventStatus;
  ledger: number;
  ts: number;
  txHash: string;
}

export interface CandlePoint {
  /** Bucket start, Unix seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Read-side aggregates over the indexer's events_raw log and positions
 * projection: trailing traded notional (fee-tier preview), per-asset open
 * interest, and realized trade history. position_closed / liquidated
 * payloads carry no size or asset, so realized legs join back to their
 * position_opened event by positionId.
 *
 * The leaderboard is scoped to the CURRENT market contract (redeploys used
 * to leak retired-deployment rows into the totals — the exact bug the web
 * cron had) and folds in the one-time `leaderboard_legacy` baseline
 * imported from the retired web pipeline.
 */
export class StatsService {
  private readonly cache = new TtlCache<AssetStats[]>(STATS_TTL_MS);
  private readonly lbCache = new TtlCache<LeaderboardBoard>(STATS_TTL_MS);
  private readonly candleCache = new TtlCache<CandlePoint[]>(STATS_TTL_MS);

  constructor(
    private readonly db: Db,
    /** Current market contract id — leaderboard scans are scoped to it. */
    private readonly marketContractId: string = '',
  ) {}

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
          SELECT payload_json ->> 'size' AS size
          FROM events_raw
          WHERE topic = 'position_opened'
            AND payload_json ->> 'trader' = ?
            AND ledger_close_ts >= ?
        `,
        args: [address, since],
      });
      const closes = await this.db.execute({
        sql: `
          SELECT o.payload_json ->> 'size' AS size
          FROM events_raw c
          JOIN events_raw o
            ON o.topic = 'position_opened'
           AND (o.payload_json ->> 'positionId') = (c.payload_json ->> 'positionId')
          WHERE c.topic = 'position_closed'
            AND c.payload_json ->> 'trader' = ?
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
          SELECT payload_json ->> 'asset' AS asset,
                 payload_json ->> 'size' AS size
          FROM events_raw
          WHERE topic = 'position_opened'
            AND ledger_close_ts >= ?
        `,
        args: [since],
      });
      for (const row of opens.rows) bucket(String(row.asset)).volume += BigInt(String(row.size));
      const realized = await this.db.execute({
        sql: `
          SELECT o.payload_json ->> 'asset' AS asset,
                 o.payload_json ->> 'size' AS size
          FROM events_raw c
          JOIN events_raw o
            ON o.topic = 'position_opened'
           AND (o.payload_json ->> 'positionId') = (c.payload_json ->> 'positionId')
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
    opts: {
      trader?: string;
      asset?: string;
      beforeTs?: number;
      limit?: number;
      /** Also emit position_opened events as kind:'open' rows (Recent Trades tab). */
      includeOpens?: boolean;
    } = {},
  ): Promise<RealizedTradeRow[]> {
    const limit = Math.min(MAX_TRADES_LIMIT, Math.max(1, opts.limit ?? DEFAULT_TRADES_LIMIT));

    // Three UNION ALL branches over events_raw, one per row family. Every
    // branch selects the same column list (topic disambiguates in the
    // mapper); each assembles its own conditions so the ? placeholders line
    // up per branch. The opens branch aliases the row's OWN payload as
    // open_payload_json so the mapper reads asset/direction/size/entryPrice
    // through one code path for every kind.
    const branchColumns = (openPayload: string) => `
        SELECT c.topic AS topic, c.ledger AS ledger, c.event_id AS event_id,
               c.ledger_close_ts AS ts, c.tx_hash AS tx_hash,
               c.payload_json AS payload_json, ${openPayload} AS open_payload_json`;
    const branches: string[] = [];
    const args: (string | number)[] = [];
    const sharedConditions = (out: string[], list: (string | number)[]) => {
      if (opts.trader) {
        out.push(`c.payload_json ->> 'trader' = ?`);
        list.push(opts.trader);
      }
      if (opts.beforeTs !== undefined) {
        out.push(`c.ledger_close_ts < ?`);
        list.push(opts.beforeTs);
      }
    };

    // Realized closes + isolated liquidations, joined to their open.
    {
      const conditions = [`c.topic IN ('position_closed', 'position_liquidated')`];
      sharedConditions(conditions, args);
      if (opts.asset) {
        conditions.push(`o.payload_json ->> 'asset' = ?`);
        args.push(opts.asset);
      }
      branches.push(`${branchColumns('o.payload_json')}
        FROM events_raw c
        LEFT JOIN events_raw o
          ON o.topic = 'position_opened'
         AND (o.payload_json ->> 'positionId') = (c.payload_json ->> 'positionId')
        WHERE ${conditions.join(' AND ')}`);
    }

    // Cross-margin account liquidations. The contract emits ONE account-level
    // cross_liq (trader, totalPnl, keeperReward) and NO per-position events,
    // so these rows carry null position fields — and are skipped entirely
    // under an asset filter (they have no asset to match).
    if (!opts.asset) {
      const conditions = [`c.topic = 'cross_liq'`];
      sharedConditions(conditions, args);
      branches.push(`${branchColumns('NULL')}
        FROM events_raw c
        WHERE ${conditions.join(' AND ')}`);
    }

    // Opens, opt-in: the Recent Trades tab shows Long/Short entries alongside
    // closes and liquidations.
    if (opts.includeOpens) {
      const conditions = [`c.topic = 'position_opened'`];
      sharedConditions(conditions, args);
      if (opts.asset) {
        conditions.push(`c.payload_json ->> 'asset' = ?`);
        args.push(opts.asset);
      }
      branches.push(`${branchColumns('c.payload_json')}
        FROM events_raw c
        WHERE ${conditions.join(' AND ')}`);
    }

    try {
      const result = await this.db.execute({
        sql: `
          SELECT * FROM (
            ${branches.join('\n          UNION ALL\n')}
          ) merged
          ORDER BY ledger DESC, event_id DESC
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
   * Order lifecycle fold over events_raw: order_placed rows resolved to
   * open / executed / cancelled by joining the terminal events on orderId.
   * The order_placed payload carries only (orderId, trader, triggerPrice) —
   * asset/direction/size live on-chain — so this is an id-hint feed: clients
   * hydrate detail per id (get_order) for JUST the ids returned here instead
   * of scanning every order id on the market (web KNOWN_ISSUES P-1).
   * Scoped to the current market deployment for the same reason the
   * leaderboard is: pre-redeploy order_placed events with no terminal event
   * would otherwise surface as phantom forever-open orders.
   */
  async listOrders(
    opts: { trader?: string; status?: 'open' | 'all'; limit?: number } = {},
  ): Promise<OrderEventRow[]> {
    const limit = Math.min(MAX_ORDERS_LIMIT, Math.max(1, opts.limit ?? DEFAULT_ORDERS_LIMIT));
    const openOnly = opts.status !== 'all';
    // Correlated probe for a terminal event of the given topic. Inlined
    // (not a placeholder) so it can appear in both WHERE and SELECT.
    const terminal = (topic: 'order_executed' | 'order_cancelled') => `EXISTS (
      SELECT 1 FROM events_raw t
      WHERE t.topic = '${topic}'
        AND t.contract_id = p.contract_id
        AND (t.payload_json ->> 'orderId') = (p.payload_json ->> 'orderId')
    )`;
    const conditions = [`p.topic = 'order_placed'`];
    const args: (string | number)[] = [];
    if (this.marketContractId) {
      conditions.push(`p.contract_id = ?`);
      args.push(this.marketContractId);
    }
    if (opts.trader) {
      conditions.push(`p.payload_json ->> 'trader' = ?`);
      args.push(opts.trader);
    }
    if (openOnly) {
      conditions.push(`NOT ${terminal('order_executed')}`);
      conditions.push(`NOT ${terminal('order_cancelled')}`);
    }
    try {
      const result = await this.db.execute({
        sql: `
          SELECT p.payload_json AS payload_json,
                 p.ledger AS ledger, p.ledger_close_ts AS ts, p.tx_hash AS tx_hash,
                 CASE
                   WHEN ${terminal('order_executed')} THEN 'executed'
                   WHEN ${terminal('order_cancelled')} THEN 'cancelled'
                   ELSE 'open'
                 END AS status
          FROM events_raw p
          WHERE ${conditions.join(' AND ')}
          ORDER BY p.ledger DESC, p.event_id DESC
          LIMIT ?
        `,
        args: [...args, limit],
      });
      return result.rows.map(mapOrderEventRow);
    } catch (err) {
      if (isMissingTable(err)) return [];
      throw err;
    }
  }

  /**
   * Trader leaderboard from the indexer projections — the durable
   * replacement for the web cron that re-scanned Horizon (audit W-5 / P4-26).
   * Ranks by realized PnL (sum of position_closed pnl) or traded notional
   * (opens + matched closes, mirroring the fee-tier volume model). Scoped to
   * the current market deployment, then merged with the one-time
   * leaderboard_legacy baseline (pre-2026-07-06 history from the retired web
   * pipeline). Sums are folded in BigInt so large i128 totals stay exact.
   * Cached briefly to absorb anonymous polling.
   */
  async leaderboard(
    opts: { sort?: LeaderboardSort; limit?: number } = {},
  ): Promise<LeaderboardBoard> {
    const sort: LeaderboardSort = opts.sort === 'volume' ? 'volume' : 'pnl';
    const limit = Math.min(
      MAX_LEADERBOARD_LIMIT,
      Math.max(1, opts.limit ?? DEFAULT_LEADERBOARD_LIMIT),
    );
    return this.lbCache.getOrLoad(`${sort}:${limit}`, () => this.computeLeaderboard(sort, limit));
  }

  private async computeLeaderboard(sort: LeaderboardSort, limit: number): Promise<LeaderboardBoard> {
    const board = new Map<string, { pnl: bigint; volume: bigint; trades: number; liqCount: number }>();
    const bucket = (trader: string) => {
      let b = board.get(trader);
      if (!b) {
        b = { pnl: 0n, volume: 0n, trades: 0, liqCount: 0 };
        board.set(trader, b);
      }
      return b;
    };
    const market = this.marketContractId;

    try {
      const pnl = await this.db.execute({
        sql: `
          SELECT payload_json ->> 'trader' AS trader,
                 payload_json ->> 'pnl' AS pnl
          FROM events_raw
          WHERE topic = 'position_closed' AND contract_id = ?
        `,
        args: [market],
      });
      for (const row of pnl.rows) {
        const trader = row.trader == null ? '' : String(row.trader);
        if (trader) bucket(trader).pnl += toBigInt(row.pnl);
      }
      const opens = await this.db.execute({
        sql: `
          SELECT payload_json ->> 'trader' AS trader,
                 payload_json ->> 'size' AS size
          FROM events_raw
          WHERE topic = 'position_opened' AND contract_id = ?
        `,
        args: [market],
      });
      for (const row of opens.rows) {
        const trader = row.trader == null ? '' : String(row.trader);
        if (trader) {
          const b = bucket(trader);
          b.volume += toBigInt(row.size);
          b.trades += 1;
        }
      }
      const closes = await this.db.execute({
        sql: `
          SELECT c.payload_json ->> 'trader' AS trader,
                 o.payload_json ->> 'size' AS size
          FROM events_raw c
          JOIN events_raw o
            ON o.topic = 'position_opened'
           AND o.contract_id = c.contract_id
           AND (o.payload_json ->> 'positionId') = (c.payload_json ->> 'positionId')
          WHERE c.topic = 'position_closed' AND c.contract_id = ?
        `,
        args: [market],
      });
      for (const row of closes.rows) {
        const trader = row.trader == null ? '' : String(row.trader);
        if (trader) bucket(trader).volume += toBigInt(row.size);
      }
      const liqs = await this.db.execute({
        sql: `
          SELECT payload_json ->> 'trader' AS trader
          FROM events_raw
          WHERE topic IN ('position_liquidated', 'position_partial_liq', 'cross_liq')
            AND contract_id = ?
        `,
        args: [market],
      });
      for (const row of liqs.rows) {
        const trader = row.trader == null ? '' : String(row.trader);
        if (trader) bucket(trader).liqCount += 1;
      }
    } catch (err) {
      if (isMissingTable(err)) return { updatedAt: null, leaders: [] };
      throw err;
    }

    // One-time baseline from the retired web pipeline (values already in
    // 7-dec units — the import script scales them). Absent table = no merge.
    try {
      const legacy = await this.db.execute(
        'SELECT address, trade_count, total_volume, total_pnl, liq_count FROM leaderboard_legacy',
      );
      for (const row of legacy.rows) {
        const trader = row.address == null ? '' : String(row.address);
        if (!trader) continue;
        const b = bucket(trader);
        b.pnl += toBigInt(row.total_pnl);
        b.volume += toBigInt(row.total_volume);
        b.trades += Number(row.trade_count ?? 0);
        b.liqCount += Number(row.liq_count ?? 0);
      }
    } catch (err) {
      if (!isMissingTable(err)) throw err;
    }

    const entries: LeaderboardEntry[] = [...board.entries()].map(([trader, b]) => ({
      trader,
      pnl: b.pnl.toString(),
      volume: b.volume.toString(),
      trades: b.trades,
      liqCount: b.liqCount,
    }));
    entries.sort((a, b) => {
      const av = sort === 'volume' ? BigInt(a.volume) : BigInt(a.pnl);
      const bv = sort === 'volume' ? BigInt(b.volume) : BigInt(b.pnl);
      return bv > av ? 1 : bv < av ? -1 : 0;
    });

    return { updatedAt: await this.cursorUpdatedAt(), leaders: entries.slice(0, limit) };
  }

  /** poll_cursor.updated_at (ms) → unix seconds; null before first poll. */
  private async cursorUpdatedAt(): Promise<number | null> {
    try {
      const res = await this.db.execute('SELECT updated_at FROM poll_cursor WHERE id = 1');
      const raw = res.rows[0]?.updated_at;
      if (raw == null) return null;
      const ms = Number(raw);
      return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : null;
    } catch (err) {
      if (isMissingTable(err)) return null;
      throw err;
    }
  }

  /**
   * Native OHLC candles for one (asset, interval), oldest-first, from the
   * `candles` projection the indexer aggregator writes. Empty when the venue
   * has none yet — the route then falls back to Binance reference candles.
   */
  async candles(opts: { asset: string; interval: string; limit?: number }): Promise<CandlePoint[]> {
    const limit = Math.min(MAX_CANDLES_LIMIT, Math.max(1, opts.limit ?? DEFAULT_CANDLES_LIMIT));
    const key = `${opts.asset}:${opts.interval}:${limit}`;
    return this.candleCache.getOrLoad(key, () => this.queryCandles(opts.asset, opts.interval, limit));
  }

  private async queryCandles(asset: string, interval: string, limit: number): Promise<CandlePoint[]> {
    try {
      const res = await this.db.execute({
        sql: `
          SELECT bucket_ts, open, high, low, close
          FROM candles
          WHERE asset = ? AND interval = ?
          ORDER BY bucket_ts DESC
          LIMIT ?
        `,
        args: [asset, interval, limit],
      });
      // Newest-first from SQL → reverse to oldest-first for the chart.
      return res.rows.reverse().map(candlePointFromRow);
    } catch (err) {
      if (isMissingTable(err)) return [];
      throw err;
    }
  }
}

function mapRealizedRow(row: Row): RealizedTradeRow {
  const payload = JSON.parse(String(row.payload_json)) as {
    positionId?: number;
    trader?: string;
    pnl?: string;
    closePrice?: string;
    totalPnl?: string;
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
  const topic = String(row.topic);
  const kind: RealizedTradeRow['kind'] =
    topic === 'position_opened'
      ? 'open'
      : topic === 'cross_liq'
        ? 'cross_liquidation'
        : topic === 'position_liquidated'
          ? 'liquidation'
          : 'close';
  return {
    // cross_liq is account-level: no position id (and no asset/size below).
    positionId: kind === 'cross_liquidation' ? null : Number(payload.positionId ?? 0),
    trader: String(payload.trader ?? ''),
    kind,
    asset: open?.asset ?? null,
    direction: open?.direction ?? null,
    size: open?.size ?? null,
    entryPrice: open?.entryPrice ?? null,
    closePrice: kind === 'open' ? null : (payload.closePrice ?? null),
    // Closes carry per-position pnl; cross liquidations carry the account
    // total. Opens and isolated liquidations have none (liq events omit pnl).
    pnl:
      kind === 'close'
        ? (payload.pnl ?? null)
        : kind === 'cross_liquidation'
          ? (payload.totalPnl ?? null)
          : null,
    ledger: Number(row.ledger),
    ts: Number(row.ts),
    txHash: String(row.tx_hash),
  };
}

function mapOrderEventRow(row: Row): OrderEventRow {
  const payload = JSON.parse(String(row.payload_json)) as {
    orderId?: number;
    trader?: string;
    triggerPrice?: string;
  };
  const status = String(row.status);
  return {
    orderId: Number(payload.orderId ?? 0),
    trader: String(payload.trader ?? ''),
    triggerPrice: String(payload.triggerPrice ?? '0'),
    status: status === 'executed' || status === 'cancelled' ? status : 'open',
    ledger: Number(row.ledger),
    ts: Number(row.ts),
    txHash: String(row.tx_hash),
  };
}

function candlePointFromRow(row: Row): CandlePoint {
  return {
    time: Number(row.bucket_ts),
    open: Number(row.open) / PRICE_SCALE,
    high: Number(row.high) / PRICE_SCALE,
    low: Number(row.low) / PRICE_SCALE,
    close: Number(row.close) / PRICE_SCALE,
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

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
