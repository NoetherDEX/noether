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

export class MarketsApi {
  constructor(private readonly transport: Transport) {}

  async list(): Promise<MarketSummary[]> {
    const res = await this.transport.request<{ markets: MarketSummary[] }>({ path: '/v1/markets' });
    return res.markets;
  }

  async get(asset: string): Promise<MarketSummary> {
    return this.transport.request<MarketSummary>({ path: `/v1/markets/${asset.toUpperCase()}` });
  }
}
