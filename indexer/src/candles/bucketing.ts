/**
 * Pure candle-bucketing core (no I/O) so the rollover logic is unit-testable.
 *
 * A candle "bucket" is the interval-aligned start second that a price
 * observation falls into. The aggregator keeps one BucketState per
 * (asset, interval) and folds each Noeracle price into it; when the bucket
 * rolls over, the just-completed candle is emitted for persistence.
 */

export interface IntervalDef {
  /** Label + Binance kline interval (they match 1:1: 1m,5m,15m,1h,4h,1d,1w). */
  name: string;
  sec: number;
  /** Alignment offset in seconds (see 1w note below). */
  offset: number;
}

export const CANDLE_INTERVALS: readonly IntervalDef[] = [
  { name: '1m', sec: 60, offset: 0 },
  { name: '5m', sec: 300, offset: 0 },
  { name: '15m', sec: 900, offset: 0 },
  { name: '1h', sec: 3600, offset: 0 },
  { name: '4h', sec: 14_400, offset: 0 },
  { name: '1d', sec: 86_400, offset: 0 },
  // Binance weekly klines open Monday 00:00 UTC. The Unix epoch is a Thursday,
  // so a plain floor would land on Thursdays and diverge from the seed. 345600s
  // = the first Monday (1970-01-05), which realigns week buckets to Monday.
  { name: '1w', sec: 604_800, offset: 345_600 },
];

/** Start (Unix seconds) of the interval bucket that contains `ts`. */
export function bucketStart(ts: number, sec: number, offset = 0): number {
  return ts - ((((ts - offset) % sec) + sec) % sec);
}

export interface BucketState {
  bucket: number;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  /** True once we've observed this bucket from its open (see stepBucket). */
  owned: boolean;
}

export interface CandleRow {
  bucketTs: number;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
}

export interface StepResult {
  state: BucketState;
  /** A completed candle to persist, emitted only on an owned bucket's rollover. */
  closed: CandleRow | null;
}

/**
 * Fold one price observation into a single (asset, interval) bucket state.
 *
 * The first observation of a bucket already in progress at startup is tracked
 * but NOT "owned" — we didn't see its true open, so emitting it would record a
 * wrong open. Only buckets seen from their first tick are owned and persisted;
 * the Binance seed covers that one boundary bar.
 */
export function stepBucket(
  prev: BucketState | undefined,
  bucket: number,
  price: bigint,
): StepResult {
  if (!prev) {
    return {
      state: { bucket, open: price, high: price, low: price, close: price, owned: false },
      closed: null,
    };
  }

  if (bucket === prev.bucket) {
    return {
      state: {
        bucket,
        open: prev.open,
        high: price > prev.high ? price : prev.high,
        low: price < prev.low ? price : prev.low,
        close: price,
        owned: prev.owned,
      },
      closed: null,
    };
  }

  if (bucket > prev.bucket) {
    const closed: CandleRow | null = prev.owned
      ? { bucketTs: prev.bucket, open: prev.open, high: prev.high, low: prev.low, close: prev.close }
      : null;
    // We saw the new bucket's first tick, so we own it going forward.
    return {
      state: { bucket, open: price, high: price, low: price, close: price, owned: true },
      closed,
    };
  }

  // bucket < prev.bucket → out-of-order (clock skew / replay). Ignore.
  return { state: prev, closed: null };
}
