import type { Asset } from '../types/index.js';
import type { Transport } from '../transport.js';

export interface OracleSnapshot {
  asset: string;
  /** 7-decimal integer as string (preserves bigint precision). */
  price: string;
  /** Human-readable float (number-precision; lossy for very large values). */
  priceFloat: number;
  timestamp: number;
}

export interface MarketSummary {
  asset: Asset;
  oracle: OracleSnapshot;
}

/**
 * Per asset open interest and 24h traded volume. All amounts are i128
 * decimal strings with 7 decimal USDC precision.
 */
/** Which vault gate binds first if an order grew by one more unit (L1-13). */
export type CapacityBinding = 'aggregate' | 'side' | 'skew' | 'liquidity' | 'maxPosition';

/**
 * Pool-capacity headroom for one market (L1-13): the largest notional the
 * vault accepts for a new long / short right now, with the chain inputs
 * behind it. Advisory — the contract enforces (#82 / #89). 7 decimal USDC
 * strings. Present only when the gateway's chain read succeeded.
 */
export interface AssetCapacity {
  headroomLong: string;
  headroomShort: string;
  bindingLong: CapacityBinding;
  bindingShort: CapacityBinding;
  /** Chain AssetExposure: long, short, long − short. */
  oiLong: string;
  oiShort: string;
  netSkew: string;
  /** Effective per side OI cap and net skew cap, in notional. */
  sideCap: string;
  skewCap: string;
  assetCapBps: number;
  capAbs: string;
  skewCapBps: number;
  /** Market max_position_size; null when unset on chain. */
  maxPositionSize: string | null;
}

/** Vault wide capacity (L1-13). Present only when the chain read succeeded. */
export interface PoolCapacity {
  aum: string;
  reservedPayout: string;
  usdcBalance: string;
  shortfallReserve: string;
  reserveCapBps: number;
  reserveCap: string;
  /** Room left for new positions on ANY market. */
  aggregateHeadroom: string;
  aggregateBinding: 'aggregate' | 'liquidity';
  asOfLedger: number | null;
  /** Unix ms the snapshot was computed. */
  ts: number;
  /** True when served from the last good snapshot after a failed refresh. */
  stale: boolean;
}

export interface AssetStats {
  asset: string;
  openInterestLong: string;
  openInterestShort: string;
  openInterestNet: string;
  openPositions: number;
  volume24h: string;
  /** L1-13 headroom; absent (never zeroed) when the gateway could not read the chain. */
  capacity?: AssetCapacity;
}

/**
 * Market scoped lifetime bad debt: how much the insurance buffer
 * absorbed vs how much fell through to LP NAV. 7 decimal USDC strings.
 */
export interface SolvencyStats {
  cumulativeBadDebtCovered: string;
  cumulativeBadDebtLpAbsorbed: string;
  badDebtEvents: number;
}

/**
 * Market custody invariant as last self-reported by the keeper: the USDC the
 * market contract holds vs the collateral it holds for traders (live isolated
 * collateral + open cross-position collateral + cross pools + pending
 * entry-order escrow). `deficit` must be "0"; anything else means payouts are
 * about to fail. 7 decimal USDC strings.
 */
export interface MarketCustody {
  marketUsdcBalance: string;
  trackedCustody: string;
  isolatedCollateral: string;
  /** Collateral locked in open cross positions. Absent from keeper builds before 2026-09-02. */
  crossPositionCollateral?: string;
  crossBalances: string;
  orderEscrow: string;
  deficit: string;
  positions: number;
  /** Unix ms the keeper computed it. */
  asOf: number;
  /** Age of the report when served. */
  ageMs: number;
  /** True when the last report is older than 5 minutes — unknown, not healthy. */
  stale: boolean;
}

export interface MarketStatsResponse {
  stats: AssetStats[];
  solvency: SolvencyStats;
  /** L1-13 vault wide capacity; absent when the gateway could not read the chain. */
  pool?: PoolCapacity;
  /** Keeper custody self-report; absent until the keeper has reported one. */
  custody?: MarketCustody;
}

/** Intervals accepted by GET /v1/candles. */
export type MarketCandleInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

/** One OHLC bucket. Prices are floats; `time` is the bucket start in unix seconds. */
export interface CandlePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface CandlesQuery {
  /** Gateway default '1h'. */
  interval?: MarketCandleInterval;
  /** Max 1000; gateway default 500. */
  limit?: number;
}

export interface CandlesResponse {
  /** Oldest first. */
  candles: CandlePoint[];
  /**
   * 'noeracle' when built from venue data by the indexer aggregator;
   * 'binance' when the gateway fell back to reference candles because
   * the venue has none yet for that asset and interval.
   */
  source: 'noeracle' | 'binance';
}

export class MarketsApi {
  constructor(private readonly transport: Transport) {}

  async list(): Promise<MarketSummary[]> {
    const res = await this.transport.request<{ markets: MarketSummary[] }>({ path: '/v1/markets' });
    return res.markets;
  }

  async get(asset: string): Promise<MarketSummary> {
    return this.transport.request<MarketSummary>({ path: `/v1/markets/${asset.toUpperCase()}` });
  }

  /**
   * Public. Per asset open interest and 24h volume for every supported
   * market, plus the protocol solvency summary and — when the gateway could
   * read the chain — the L1-13 pool-capacity headroom per asset (`capacity`)
   * and vault wide (`pool`).
   */
  async stats(): Promise<MarketStatsResponse> {
    return this.transport.request<MarketStatsResponse>({ path: '/v1/markets/stats' });
  }

  /** Public. OHLC candles for an asset, oldest first. */
  async candles(asset: string, query: CandlesQuery = {}): Promise<CandlesResponse> {
    return this.transport.request<CandlesResponse>({
      path: '/v1/candles',
      query: { asset: asset.toUpperCase(), interval: query.interval, limit: query.limit },
    });
  }
}
