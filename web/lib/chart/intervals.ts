/**
 * Interval bucketing for the client-built live candle. MUST match the indexer
 * aggregator's alignment (indexer/src/candles/bucketing.ts) so the forming bar
 * the frontend draws lands on the same bucket the backend eventually persists.
 */

const INTERVAL_SEC: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14_400,
  '1d': 86_400,
  '1w': 604_800,
};

// Binance weekly klines (and our aggregator) align to Monday 00:00 UTC; the
// Unix epoch is a Thursday, so a plain floor would misalign the 1w bucket.
const INTERVAL_OFFSET: Record<string, number> = { '1w': 345_600 };

export function intervalSeconds(interval: string): number {
  return INTERVAL_SEC[interval] ?? 3600;
}

/** Start (Unix seconds) of the bucket containing `ts` for this interval. */
export function bucketStartSec(ts: number, interval: string): number {
  const sec = intervalSeconds(interval);
  const off = INTERVAL_OFFSET[interval] ?? 0;
  return ts - ((((ts - off) % sec) + sec) % sec);
}
