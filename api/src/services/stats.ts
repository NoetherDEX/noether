import { isMissingTable, type Db, type Row } from '@noether/db';
import {
  SUPPORTED_ASSETS,
  resolveScope,
  scopeFromEnv,
  scopeServedByNetwork,
  type DeploymentScope,
} from '@noether/shared';
import type { Network } from '@noether/types';
import { TtlCache } from './cache.js';

const DAY_SEC = 86_400;
export const VOLUME_WINDOW_SEC = 14 * DAY_SEC;

const STATS_TTL_MS = 5_000;
/**
 * The leaderboard reads are full aggregates over events_raw — the most
 * expensive queries in the service. A 5s TTL bought no freshness anyone could
 * observe: the indexer cursor is ~2s behind, and the web proxy caches for 30s
 * on top. Holding for 20s cuts the scan rate fourfold with no visible change.
 */
const LEADERBOARD_TTL_MS = 20_000;
const DEFAULT_TRADES_LIMIT = 50;
const MAX_TRADES_LIMIT = 200;
const DEFAULT_ORDERS_LIMIT = 50;
const MAX_ORDERS_LIMIT = 200;
const DEFAULT_LEADERBOARD_LIMIT = 20;
const MAX_LEADERBOARD_LIMIT = 200;
/** Retired board snapshots kept per (scope, sort) so a client mid page walk
 *  can finish on the immutable rows it started on. */
const SNAPSHOT_HISTORY_DEPTH = 2;
const DEFAULT_CANDLES_LIMIT = 500;
const MAX_CANDLES_LIMIT = 1000;
const PRICE_SCALE = 10_000_000;

export type LeaderboardSort = 'pnl' | 'volume';

/**
 * Board availability for a requested scope. 'not_indexed_here' means the
 * scope belongs to another Stellar network than this gateway serves, so its
 * rows do not exist in this database at all.
 */
export type LeaderboardState = 'ok' | 'empty' | 'not_indexed_here';

export interface LeaderboardEntry {
  /** Position in the full ranked board, 1 based, stable across pages. */
  rank: number;
  trader: string;
  /** Realized PnL, 7 decimal USDC (live market + legacy baseline). */
  pnl: string;
  /** Traded notional, 7 decimal (opens + matched closes, + legacy baseline). */
  volume: string;
  /** Trade count (position_opened rows, + legacy baseline). */
  trades: number;
  /** Liquidation count (full/partial/cross, + legacy baseline). */
  liqCount: number;
}

/**
 * One immutable computation of the full ranked board for a (scope, sort)
 * pair. Pages are slices of `rows`, so ranks never shift and rows never
 * duplicate or vanish between pages served from the same snapshot.
 */
export interface BoardSnapshot {
  /** `${scope}.${sort}.${cursorLedger}.${total}` */
  id: string;
  /** Wall clock at computation (ms). */
  computedAt: number;
  /** poll_cursor.last_ledger at computation. */
  cursorLedger: number;
  /** poll_cursor.updated_at (unix seconds); null before the first poll. */
  updatedAt: number | null;
  total: number;
  rows: LeaderboardEntry[];
}

export interface LeaderboardPage {
  scope: string;
  network: string;
  state: LeaderboardState;
  sort: LeaderboardSort;
  /** poll_cursor.updated_at (unix seconds), when the index last advanced. */
  updatedAt: number | null;
  /** Distinct traders on the full board, not just this page. */
  total: number;
  limit: number;
  offset: number;
  snapshot: string;
  /** True when the caller asked for a snapshot this service no longer holds
   *  and was served the current one instead. */
  snapshotChanged: boolean;
  leaders: LeaderboardEntry[];
}

export interface LeaderboardRank {
  scope: string;
  network: string;
  state: LeaderboardState;
  sort: LeaderboardSort;
  trader: string;
  /** 1 based rank on the full board; null when the trader is not on it. */
  rank: number | null;
  total: number;
  snapshot: string;
  updatedAt: number | null;
  /** The trader's full board row, when present. */
  entry: LeaderboardEntry | null;
}

export interface LeaderboardTotals {
  scope: string;
  network: string;
  state: LeaderboardState;
  /** poll_cursor.updated_at (unix seconds), when the index last advanced. */
  updatedAt: number | null;
  /** Distinct traders across the whole market, NOT just the returned page. */
  traders: number;
  /** Traded notional, 7 decimal (opens + matched closes, + legacy baseline). */
  volume: string;
  /** Trade count (position_opened rows, + legacy baseline). */
  trades: number;
}

export interface AssetStats {
  asset: string;
  openInterestLong: string;
  openInterestShort: string;
  openInterestNet: string;
  openPositions: number;
  volume24h: string;
}

/** Protocol-level solvency summary (L0-2): lifetime bad debt the insurance
 * buffer absorbed vs what fell through to LP NAV, market-scoped. 7-decimal
 * USDC strings. Chain-truth buffer balance is served separately via the
 * vault views (get_buffer_balance); these are the indexed cumulative
 * totals nothing else exposes. */
export interface SolvencyStats {
  cumulativeBadDebtCovered: string;
  cumulativeBadDebtLpAbsorbed: string;
  badDebtEvents: number;
}

export interface RealizedTradeRow {
  /** Null for account-level rows (cross_liquidation carries no position id). */
  positionId: number | null;
  trader: string;
  kind: 'open' | 'close' | 'liquidation' | 'cross_liquidation' | 'adl';
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
 * The leaderboard is scoped per deployment scope (see the shared scope
 * registry): a scope names the market contract ids whose events feed its
 * board plus the leaderboard_legacy baseline slice it may inherit, so a
 * redeploy cannot leak retired rows and a mainnet scope can never inherit
 * testnet history. The single market reads (volume, open interest, trades)
 * stay pinned to the CURRENT market contract as before.
 */
export class StatsService {
  private readonly cache = new TtlCache<AssetStats[]>(STATS_TTL_MS);
  private readonly solvencyCache = new TtlCache<SolvencyStats>(STATS_TTL_MS);
  private readonly snapCache = new TtlCache<BoardSnapshot>(LEADERBOARD_TTL_MS);
  /** Newest first, most recent SNAPSHOT_HISTORY_DEPTH snapshots per
   *  `${scope}.${sort}` key (the current one included). */
  private readonly snapHistory = new Map<string, BoardSnapshot[]>();
  private readonly totalsCache = new TtlCache<LeaderboardTotals>(LEADERBOARD_TTL_MS);
  private readonly candleCache = new TtlCache<CandlePoint[]>(STATS_TTL_MS);

  constructor(
    private readonly db: Db,
    /** Current market contract id — leaderboard scans are scoped to it. */
    private readonly marketContractId: string = '',
    /** Stellar network this gateway serves. A leaderboard request for a
     *  scope on another network is answered not_indexed_here instead of
     *  leaking this network's rows into it. */
    private readonly network: Network = 'testnet',
  ) {}

  /**
   * Trailing 14-day traded notional for one wallet (i128, 7-dec USDC).
   * Mirrors the market contract's rolling VolumeRecord: opens and closes
   * each record the position's full size; liquidations record nothing.
   */
  async traderVolume14d(address: string, now = nowSec()): Promise<bigint> {
    const since = now - VOLUME_WINDOW_SEC;
    // Position ids restart at 1 for every market deployment, so a bare
    // positionId join matches opens from retired markets. Correlating
    // contract_id on the join is what makes the pairing 1:1; the extra scope
    // predicate then keeps retired deployments out of the window entirely.
    const scope = this.marketContractId ? 'AND contract_id = ?' : '';
    const scopeC = this.marketContractId ? 'AND c.contract_id = ?' : '';
    try {
      const opens = await this.db.execute({
        sql: `
          SELECT payload_json ->> 'size' AS size
          FROM events_raw
          WHERE topic = 'position_opened'
            AND payload_json ->> 'trader' = ?
            AND ledger_close_ts >= ?
            ${scope}
        `,
        args: this.marketContractId
          ? [address, since, this.marketContractId]
          : [address, since],
      });
      const closes = await this.db.execute({
        sql: `
          SELECT o.payload_json ->> 'size' AS size
          FROM events_raw c
          JOIN events_raw o
            ON o.topic = 'position_opened'
           AND o.contract_id = c.contract_id
           AND (o.payload_json ->> 'positionId') = (c.payload_json ->> 'positionId')
          WHERE c.topic = 'position_closed'
            AND c.payload_json ->> 'trader' = ?
            AND c.ledger_close_ts >= ?
            ${scopeC}
        `,
        args: this.marketContractId
          ? [address, since, this.marketContractId]
          : [address, since],
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

  /** Market-scoped cumulative bad-debt totals from the L0-2 projection. */
  async solvencyStats(): Promise<SolvencyStats> {
    return this.solvencyCache.getOrLoad('solvency_stats', () => this.computeSolvencyStats());
  }

  private async computeSolvencyStats(): Promise<SolvencyStats> {
    const empty: SolvencyStats = {
      cumulativeBadDebtCovered: '0',
      cumulativeBadDebtLpAbsorbed: '0',
      badDebtEvents: 0,
    };
    try {
      const res = await this.db.execute({
        sql: `
          SELECT
            COALESCE(SUM((buffer_covered)::numeric), 0)::text AS covered,
            COALESCE(SUM((lp_absorbed)::numeric), 0)::text AS absorbed,
            COUNT(*) AS n
          FROM bad_debt
          WHERE contract_id = ?
        `,
        args: [this.marketContractId],
      });
      const row = res.rows[0];
      if (!row) return empty;
      return {
        cumulativeBadDebtCovered: String(row.covered ?? '0'),
        cumulativeBadDebtLpAbsorbed: String(row.absorbed ?? '0'),
        badDebtEvents: Number(row.n ?? 0),
      };
    } catch (err) {
      if (isMissingTable(err)) return empty;
      throw err;
    }
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
      // Scoped like every other read: the projection keeps rows from retired
      // deployments, and counting them inflates open interest and the open
      // position count for assets nobody is trading on this market.
      const open = this.marketContractId
        ? await this.db.execute({
            sql: 'SELECT asset, direction, size FROM positions WHERE contract_id = ?',
            args: [this.marketContractId],
          })
        : await this.db.execute('SELECT asset, direction, size FROM positions');
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
      const scope = this.marketContractId ? 'AND contract_id = ?' : '';
      const scopeC = this.marketContractId ? 'AND c.contract_id = ?' : '';
      const opens = await this.db.execute({
        sql: `
          SELECT payload_json ->> 'asset' AS asset,
                 payload_json ->> 'size' AS size
          FROM events_raw
          WHERE topic = 'position_opened'
            AND ledger_close_ts >= ?
            ${scope}
        `,
        args: this.marketContractId ? [since, this.marketContractId] : [since],
      });
      for (const row of opens.rows) bucket(String(row.asset)).volume += BigInt(String(row.size));
      const realized = await this.db.execute({
        sql: `
          SELECT o.payload_json ->> 'asset' AS asset,
                 o.payload_json ->> 'size' AS size
          FROM events_raw c
          JOIN events_raw o
            ON o.topic = 'position_opened'
           AND o.contract_id = c.contract_id
           AND (o.payload_json ->> 'positionId') = (c.payload_json ->> 'positionId')
          WHERE c.topic IN ('position_closed', 'position_liquidated')
            AND c.ledger_close_ts >= ?
            ${scopeC}
        `,
        args: this.marketContractId ? [since, this.marketContractId] : [since],
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
    // Applied to every branch so the args array stays aligned with the
    // placeholders each branch contributes, in branch order.
    const sharedConditions = (out: string[], list: (string | number)[]) => {
      if (this.marketContractId) {
        out.push(`c.contract_id = ?`);
        list.push(this.marketContractId);
      }
      if (opts.trader) {
        out.push(`c.payload_json ->> 'trader' = ?`);
        list.push(opts.trader);
      }
      if (opts.beforeTs !== undefined) {
        out.push(`c.ledger_close_ts < ?`);
        list.push(opts.beforeTs);
      }
    };

    // Realized closes + isolated liquidations + ADL fills, joined to their
    // open. adl_executed carries its own asset (unlike close/liq), but the
    // join still supplies direction/size/entry uniformly.
    {
      const conditions = [`c.topic IN ('position_closed', 'position_liquidated', 'adl_executed')`];
      sharedConditions(conditions, args);
      if (opts.asset) {
        conditions.push(`o.payload_json ->> 'asset' = ?`);
        args.push(opts.asset);
      }
      // Correlating contract_id is what stops one close matching opens from
      // several deployments, which duplicated the row once per match and
      // showed the retired market's asset, size and entry price.
      branches.push(`${branchColumns('o.payload_json')}
        FROM events_raw c
        LEFT JOIN events_raw o
          ON o.topic = 'position_opened'
         AND o.contract_id = c.contract_id
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

  /** The scope registry entry for the caller's requested id (or the
   *  gateway's home scope when omitted), with this service's configured
   *  market id feeding the testnet default so tests and CONTRACT_MARKET
   *  overrides resolve consistently. Unknown ids throw; the route schema
   *  rejects them first with a 400. */
  private requestScope(id?: string): DeploymentScope {
    const opts = this.marketContractId ? { currentMarketId: this.marketContractId } : undefined;
    const scope = id === undefined ? scopeFromEnv(opts) : resolveScope(id, opts);
    if (!scope) throw new Error(`Unknown leaderboard scope: ${id}`);
    return scope;
  }

  /**
   * One page of the trader leaderboard, the durable replacement for the web
   * cron that re scanned Horizon (audit W5 / P4 26). Ranking happens in ONE
   * SQL statement per (scope, sort): events scoped to the scope's market
   * ids, merged with the leaderboard_legacy baseline slice the scope may
   * inherit, grouped per trader and ordered by a total order (metric, then
   * the other metric, then trader) so ranks are unique and page boundaries
   * are deterministic even through the measured tie groups.
   *
   * Pages slice an immutable BoardSnapshot held per (scope, sort) with a
   * short TTL and a small history, so walking pages never duplicates or
   * skips a row: either the caller's snapshot is still held and every page
   * comes from the same computation, or snapshotChanged flags the swap.
   */
  async leaderboardPage(
    opts: {
      scope?: string;
      sort?: LeaderboardSort;
      limit?: number;
      offset?: number;
      snapshot?: string;
    } = {},
  ): Promise<LeaderboardPage> {
    const sort: LeaderboardSort = opts.sort === 'volume' ? 'volume' : 'pnl';
    const limit = Math.min(
      MAX_LEADERBOARD_LIMIT,
      Math.max(1, opts.limit ?? DEFAULT_LEADERBOARD_LIMIT),
    );
    const offset = Math.max(0, opts.offset ?? 0);
    const scope = this.requestScope(opts.scope);

    if (!scopeServedByNetwork(scope, this.network)) {
      // Another network's venue. This gateway does not index it, and it must
      // NEVER answer with this network's rows (a mainnet page proxying the
      // shared gateway would otherwise show testnet history).
      return {
        scope: scope.id,
        network: scope.network,
        state: 'not_indexed_here',
        sort,
        updatedAt: null,
        total: 0,
        limit,
        offset,
        snapshot: '',
        snapshotChanged: false,
        leaders: [],
      };
    }

    const { snap, snapshotChanged } = await this.snapshotFor(scope, sort, opts.snapshot);
    return {
      scope: scope.id,
      network: scope.network,
      state: snap.total === 0 ? 'empty' : 'ok',
      sort,
      updatedAt: snap.updatedAt,
      total: snap.total,
      limit,
      offset,
      snapshot: snap.id,
      snapshotChanged,
      leaders: snap.rows.slice(offset, offset + limit),
    };
  }

  /**
   * A single trader's rank + total for (scope, sort), read from the same
   * snapshot the pages slice: no extra SQL, and always consistent with
   * what the board pages show.
   */
  async leaderboardRank(opts: {
    trader: string;
    scope?: string;
    sort?: LeaderboardSort;
  }): Promise<LeaderboardRank> {
    const sort: LeaderboardSort = opts.sort === 'volume' ? 'volume' : 'pnl';
    const scope = this.requestScope(opts.scope);
    if (!scopeServedByNetwork(scope, this.network)) {
      return {
        scope: scope.id,
        network: scope.network,
        state: 'not_indexed_here',
        sort,
        trader: opts.trader,
        rank: null,
        total: 0,
        snapshot: '',
        updatedAt: null,
        entry: null,
      };
    }
    const snap = await this.currentSnapshot(scope, sort);
    const entry = snap.rows.find((r) => r.trader === opts.trader) ?? null;
    return {
      scope: scope.id,
      network: scope.network,
      state: snap.total === 0 ? 'empty' : 'ok',
      sort,
      trader: opts.trader,
      rank: entry?.rank ?? null,
      total: snap.total,
      snapshot: snap.id,
      updatedAt: snap.updatedAt,
      entry,
    };
  }

  /** Resolve which snapshot serves this request: the caller's requested one
   *  when still held (current or history), else the current one with
   *  snapshotChanged set so the client knows ranks may have moved. */
  private async snapshotFor(
    scope: DeploymentScope,
    sort: LeaderboardSort,
    requested?: string,
  ): Promise<{ snap: BoardSnapshot; snapshotChanged: boolean }> {
    const current = await this.currentSnapshot(scope, sort);
    if (!requested || requested === current.id) {
      return { snap: current, snapshotChanged: false };
    }
    const held = (this.snapHistory.get(`${scope.id}.${sort}`) ?? []).find(
      (s) => s.id === requested,
    );
    if (held) return { snap: held, snapshotChanged: false };
    return { snap: current, snapshotChanged: true };
  }

  /** Current snapshot for (scope, sort). Loads through the shared TtlCache
   *  so a burst of page requests within the TTL fires one scan; every fresh
   *  computation is pushed onto the small history ring. */
  private async currentSnapshot(
    scope: DeploymentScope,
    sort: LeaderboardSort,
  ): Promise<BoardSnapshot> {
    const key = `${scope.id}.${sort}`;
    return this.snapCache.getOrLoad(key, async () => {
      const snap = await this.computeSnapshot(scope, sort);
      const history = this.snapHistory.get(key) ?? [];
      if (history[0]?.id !== snap.id) {
        history.unshift(snap);
        this.snapHistory.set(key, history.slice(0, SNAPSHOT_HISTORY_DEPTH));
      } else {
        history[0] = snap;
      }
      return snap;
    });
  }

  private async computeSnapshot(
    scope: DeploymentScope,
    sort: LeaderboardSort,
  ): Promise<BoardSnapshot> {
    const cursor = await this.pollCursor();
    // A scope with no market ids AND no legacy inheritance is an empty venue
    // by definition (mainnet before launch): no scan at all.
    const rows =
      scope.marketIds.length === 0 && scope.legacyScopeKey === null
        ? []
        : await this.queryRankedBoard(scope, sort);
    return {
      id: `${scope.id}.${sort}.${cursor.lastLedger}.${rows.length}`,
      computedAt: Date.now(),
      cursorLedger: cursor.lastLedger,
      updatedAt: cursor.updatedAt,
      total: rows.length,
      rows,
    };
  }

  /** Full ranked board via ONE statement, tolerant of a database that does
   *  not have the tables yet. 42P01 does not say WHICH table is absent:
   *  events_raw missing means a pre first poll database and an empty board
   *  is the truth, but a missing leaderboard_legacy must not hide live
   *  rows, so retry once without the legacy branch. */
  private async queryRankedBoard(
    scope: DeploymentScope,
    sort: LeaderboardSort,
  ): Promise<LeaderboardEntry[]> {
    const withLegacy = scope.legacyScopeKey !== null;
    try {
      return await this.execRankedBoard(scope, sort, withLegacy);
    } catch (err) {
      if (!isMissingTable(err)) throw err;
      if (!withLegacy) return [];
      try {
        return await this.execRankedBoard(scope, sort, false);
      } catch (err2) {
        if (isMissingTable(err2)) return [];
        throw err2;
      }
    }
  }

  /**
   * The one ranking statement. Every realized leg becomes a (trader, pnl,
   * volume, trades, liq_count) row, folded per trader in SQL:
   *   pnl:    position_closed pnl.
   *   volume: open size plus the matched close leg. The close leg uses the
   *           close's own size when the payload carries one, else the
   *           joined open's size, keeping the same fallback and the same
   *           o.contract_id = c.contract_id join correlation the trade feed
   *           uses, so one close can never match opens from several
   *           deployments.
   *   trades: position_opened count.
   *   liq:    full/partial/cross liquidation count.
   * plus the legacy baseline rows for the scope's scope_key. Ordering is
   * row_number() over (metric DESC, other metric DESC, trader ASC): a total
   * order, so ranks are unique and OFFSET pagination cannot duplicate or
   * skip rows inside tie groups. The market id list travels as a Postgres
   * array literal string because the Db layer's InValue rejects JS arrays.
   */
  private async execRankedBoard(
    scope: DeploymentScope,
    sort: LeaderboardSort,
    withLegacy: boolean,
  ): Promise<LeaderboardEntry[]> {
    const metric = sort === 'volume' ? 'volume' : 'pnl';
    const secondary = sort === 'volume' ? 'pnl' : 'volume';
    const rankOrder = `${metric} DESC, ${secondary} DESC, trader ASC`;
    const legacyBranch = withLegacy
      ? `
        UNION ALL
        SELECT address AS trader,
               total_pnl::numeric AS pnl,
               total_volume::numeric AS volume,
               trade_count::bigint AS trades,
               liq_count::bigint AS liq_count
        FROM leaderboard_legacy
        WHERE scope_key = ?`
      : '';
    const args: (string | number)[] = [toPgTextArrayLiteral(scope.marketIds)];
    if (withLegacy) args.push(String(scope.legacyScopeKey));

    const result = await this.db.execute({
      sql: `
        WITH scoped AS (
          SELECT contract_id, topic, payload_json
          FROM events_raw
          WHERE contract_id = ANY(?::text[])
        ),
        legs AS (
          SELECT payload_json ->> 'trader' AS trader,
                 COALESCE((payload_json ->> 'pnl')::numeric, 0) AS pnl,
                 0::numeric AS volume,
                 0::bigint AS trades,
                 0::bigint AS liq_count
          FROM scoped
          WHERE topic = 'position_closed'
          UNION ALL
          SELECT payload_json ->> 'trader',
                 0::numeric,
                 COALESCE((payload_json ->> 'size')::numeric, 0),
                 1::bigint,
                 0::bigint
          FROM scoped
          WHERE topic = 'position_opened'
          UNION ALL
          SELECT c.payload_json ->> 'trader',
                 0::numeric,
                 COALESCE((c.payload_json ->> 'size')::numeric,
                          (o.payload_json ->> 'size')::numeric, 0),
                 0::bigint,
                 0::bigint
          FROM scoped c
          LEFT JOIN scoped o
            ON o.topic = 'position_opened'
           AND o.contract_id = c.contract_id
           AND (o.payload_json ->> 'positionId') = (c.payload_json ->> 'positionId')
          WHERE c.topic = 'position_closed'
          UNION ALL
          SELECT payload_json ->> 'trader',
                 0::numeric,
                 0::numeric,
                 0::bigint,
                 1::bigint
          FROM scoped
          WHERE topic IN ('position_liquidated', 'position_partial_liq', 'cross_liq')${legacyBranch}
        ),
        folded AS (
          SELECT trader,
                 SUM(pnl) AS pnl,
                 SUM(volume) AS volume,
                 SUM(trades) AS trades,
                 SUM(liq_count) AS liq_count
          FROM legs
          WHERE trader IS NOT NULL AND trader <> ''
          GROUP BY trader
        )
        SELECT trader,
               pnl::text AS pnl,
               volume::text AS volume,
               trades::bigint AS trades,
               liq_count::bigint AS liq_count,
               row_number() OVER (ORDER BY ${rankOrder}) AS rank,
               count(*) OVER () AS total
        FROM folded
        ORDER BY rank
      `,
      args,
    });
    return result.rows.map((row) => ({
      rank: Number(row.rank),
      trader: String(row.trader),
      pnl: toBigIntNumeric(row.pnl).toString(),
      volume: toBigIntNumeric(row.volume).toString(),
      trades: Number(row.trades ?? 0),
      liqCount: Number(row.liq_count ?? 0),
    }));
  }

  /**
   * Market wide headline totals, aggregated in SQL over EVERY trader.
   *
   * These deliberately do not reuse the board pages: a page holds at most
   * MAX_LEADERBOARD_LIMIT rows, so summing pages client side silently
   * undercounts once distinct traders exceed the limit (the count pins at
   * the limit and the tail's volume/trades vanish). Same semantics as the
   * board rows: volume counts the open leg plus the matched close leg,
   * trades counts position_opened only, and the legacy baseline slice the
   * scope inherits is folded in. Scoped exactly like the board so the tiles
   * on a mainnet page can never show testnet aggregates.
   */
  async leaderboardTotals(opts: { scope?: string } = {}): Promise<LeaderboardTotals> {
    const scope = this.requestScope(opts.scope);
    if (!scopeServedByNetwork(scope, this.network)) {
      return {
        scope: scope.id,
        network: scope.network,
        state: 'not_indexed_here',
        updatedAt: null,
        traders: 0,
        volume: '0',
        trades: 0,
      };
    }
    return this.totalsCache.getOrLoad(`totals:${scope.id}`, () =>
      this.computeLeaderboardTotals(scope),
    );
  }

  private async computeLeaderboardTotals(scope: DeploymentScope): Promise<LeaderboardTotals> {
    const markets = toPgTextArrayLiteral(scope.marketIds);
    const traders = new Set<string>();
    let volume = 0n;
    let trades = 0;
    const finish = (): LeaderboardTotals => ({
      scope: scope.id,
      network: scope.network,
      state: traders.size === 0 ? 'empty' : 'ok',
      updatedAt: null,
      traders: traders.size,
      volume: volume.toString(),
      trades,
    });

    try {
      const opens = await this.db.execute({
        sql: `
          SELECT COUNT(*) AS trades,
                 COALESCE(SUM((payload_json ->> 'size')::numeric), 0) AS volume
          FROM events_raw
          WHERE topic = 'position_opened' AND contract_id = ANY(?::text[])
        `,
        args: [markets],
      });
      trades += Number(opens.rows[0]?.trades ?? 0);
      volume += toBigIntNumeric(opens.rows[0]?.volume);

      // Realized close legs may carry no size: prefer the close's own size,
      // else the joined open's (same fallback as the board rows).
      const closes = await this.db.execute({
        sql: `
          SELECT COALESCE(SUM(COALESCE((c.payload_json ->> 'size')::numeric,
                                       (o.payload_json ->> 'size')::numeric, 0)), 0) AS volume
          FROM events_raw c
          LEFT JOIN events_raw o
            ON o.topic = 'position_opened'
           AND o.contract_id = c.contract_id
           AND (o.payload_json ->> 'positionId') = (c.payload_json ->> 'positionId')
          WHERE c.topic = 'position_closed' AND c.contract_id = ANY(?::text[])
        `,
        args: [markets],
      });
      volume += toBigIntNumeric(closes.rows[0]?.volume);

      // The distinct trader set is small (one row per wallet), so union it
      // here rather than in SQL, since leaderboard_legacy may not exist.
      const addrs = await this.db.execute({
        sql: `
          SELECT DISTINCT payload_json ->> 'trader' AS trader
          FROM events_raw
          WHERE contract_id = ANY(?::text[])
            AND topic IN ('position_opened', 'position_closed',
                          'position_liquidated', 'position_partial_liq', 'cross_liq')
        `,
        args: [markets],
      });
      for (const row of addrs.rows) {
        const trader = row.trader == null ? '' : String(row.trader);
        if (trader) traders.add(trader);
      }
    } catch (err) {
      if (isMissingTable(err)) return finish();
      throw err;
    }

    if (scope.legacyScopeKey !== null) {
      try {
        const legacy = await this.db.execute({
          sql: 'SELECT address, trade_count, total_volume FROM leaderboard_legacy WHERE scope_key = ?',
          args: [scope.legacyScopeKey],
        });
        for (const row of legacy.rows) {
          const trader = row.address == null ? '' : String(row.address);
          if (!trader) continue;
          traders.add(trader);
          volume += toBigInt(row.total_volume);
          trades += Number(row.trade_count ?? 0);
        }
      } catch (err) {
        if (!isMissingTable(err)) throw err;
      }
    }

    return { ...finish(), updatedAt: (await this.pollCursor()).updatedAt };
  }

  /** poll_cursor row: last_ledger for snapshot identity, updated_at (ms)
   *  mapped to unix seconds; zero/null before the first poll. */
  private async pollCursor(): Promise<{ lastLedger: number; updatedAt: number | null }> {
    try {
      const res = await this.db.execute(
        'SELECT last_ledger, updated_at FROM poll_cursor WHERE id = 1',
      );
      const row = res.rows[0];
      if (!row) return { lastLedger: 0, updatedAt: null };
      const ledger = Number(row.last_ledger);
      const ms = Number(row.updated_at);
      return {
        lastLedger: Number.isFinite(ledger) && ledger > 0 ? ledger : 0,
        updatedAt: Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : null,
      };
    } catch (err) {
      if (isMissingTable(err)) return { lastLedger: 0, updatedAt: null };
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
    asset?: string;
    direction?: number;
    size?: string;
    price?: string;
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
          : topic === 'adl_executed'
            ? 'adl'
            : 'close';
  return {
    // cross_liq is account-level: no position id (and no asset/size below).
    positionId: kind === 'cross_liquidation' ? null : Number(payload.positionId ?? 0),
    trader: String(payload.trader ?? ''),
    kind,
    // adl_executed carries its own asset/direction/size (the join may miss
    // if the open was pruned); fall back to the event payload.
    asset: open?.asset ?? payload.asset ?? null,
    direction: open?.direction ?? payload.direction ?? null,
    size: open?.size ?? payload.size ?? null,
    entryPrice: open?.entryPrice ?? null,
    // ADL fills settle at the oracle mark carried as `price`.
    closePrice: kind === 'open' ? null : (payload.closePrice ?? payload.price ?? null),
    // Closes and ADL fills carry per-position pnl; cross liquidations carry
    // the account total. Opens and isolated liquidations have none.
    pnl:
      kind === 'close' || kind === 'adl'
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

/**
 * Serialize contract ids for `= ANY(?::text[])`. The Db layer's InValue
 * type rejects JS arrays, so the parameter travels as a Postgres array
 * literal string ('{"A","B"}'). Elements are double quoted with backslash
 * escaping so no id content can change the literal's shape; an empty list
 * serializes to '{}', which matches nothing.
 */
function toPgTextArrayLiteral(ids: readonly string[]): string {
  const quoted = ids.map((id) => `"${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return `{${quoted.join(',')}}`;
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

/**
 * Postgres SUM() over numeric comes back as a string that may carry a
 * fractional tail ("123" or "123.000"); BigInt() rejects the latter.
 */
function toBigIntNumeric(value: unknown): bigint {
  if (value == null) return 0n;
  const [whole] = String(value).split('.');
  return toBigInt(whole);
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
