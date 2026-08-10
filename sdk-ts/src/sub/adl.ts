import type { Transport } from '../transport.js';

/** One candidate in the advisory auto deleveraging queue. */
export interface AdlQueueRow {
  positionId: number;
  trader: string;
  asset: string;
  direction: number;
  /** 7 decimal strings preserve i128 precision. */
  size: string;
  pnl: string;
  score: string;
  /** 1 = first to be deleveraged. */
  rank: number;
  /** 1..5 among positive pnl positions (1 = highest ADL priority). */
  quintile: number;
}

export interface AdlQueueResult {
  asset: string;
  /** Unix milliseconds when the queue was computed. */
  updatedAt: number;
  /**
   * True when the ranking could not be computed this window. An empty
   * degraded queue means unknown, never that nobody is at risk.
   */
  degraded: boolean;
  rows: AdlQueueRow[];
}

export interface AdlQueueQuery {
  /** Only return rows for this trader. */
  trader?: string;
}

export class AdlApi {
  constructor(private readonly transport: Transport) {}

  /**
   * Public. Advisory auto deleveraging queue for one asset: positive
   * pnl positions ranked by priority, refreshed on a short cache.
   */
  async queue(asset: string, query: AdlQueueQuery = {}): Promise<AdlQueueResult> {
    return this.transport.request<AdlQueueResult>({
      path: '/v1/adl/queue',
      query: { asset: asset.toUpperCase(), trader: query.trader },
    });
  }
}
