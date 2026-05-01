import { SUPPORTED_ASSETS } from '@noether/shared';
import type { Asset } from '@noether/types';
import type { OraclePrice, OracleService } from './oracle.js';

export interface MarketSummary {
  asset: Asset;
  oracle: OraclePrice;
}

/**
 * Aggregates per-market data the API hands back to clients.
 * Phase 3 v0 returns asset metadata + live oracle price.
 * Live trade volume, funding rate, and open interest are added in Phase
 * 3.1 once events_raw projections exist.
 */
export class MarketsService {
  constructor(private readonly oracle: OracleService) {}

  list(): readonly Asset[] {
    return SUPPORTED_ASSETS;
  }

  async summaries(): Promise<MarketSummary[]> {
    const prices = await this.oracle.getAllPrices();
    return SUPPORTED_ASSETS.map((asset, idx) => ({
      asset,
      oracle: prices[idx]!,
    }));
  }

  async summary(symbol: string): Promise<MarketSummary | null> {
    const asset = SUPPORTED_ASSETS.find((a) => a.symbol === symbol);
    if (!asset) return null;
    const oracle = await this.oracle.getPrice(symbol);
    return { asset, oracle };
  }
}
