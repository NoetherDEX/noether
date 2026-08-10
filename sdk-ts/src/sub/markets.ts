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
export interface AssetStats {
  asset: string;
  openInterestLong: string;
  openInterestShort: string;
  openInterestNet: string;
  openPositions: number;
  volume24h: string;
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

export interface MarketStatsResponse {
  stats: AssetStats[];
  solvency: SolvencyStats;
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
   * market, plus the protocol solvency summary.
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
