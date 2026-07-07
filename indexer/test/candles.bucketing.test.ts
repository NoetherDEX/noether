import { describe, it, expect } from 'vitest';
import { bucketStart, stepBucket, type BucketState } from '../src/candles/bucketing.js';

describe('bucketStart', () => {
  it('floors intra-day intervals to UTC boundaries', () => {
    // 2026-07-06 12:34:56 UTC = 1783341296
    const ts = 1_783_341_296;
    expect(bucketStart(ts, 60)).toBe(1_783_341_240); // 12:34:00
    expect(bucketStart(ts, 3600)).toBe(1_783_339_200); // 12:00:00
    expect(bucketStart(ts, 14_400)).toBe(1_783_339_200); // 12:00 (4h aligns to 12:00)
    expect(bucketStart(ts, 86_400)).toBe(1_783_296_000); // 00:00:00
  });

  it('aligns weekly buckets to Monday 00:00 UTC (matches Binance)', () => {
    // 2026-07-08 is a Wednesday; its week should start Monday 2026-07-06 00:00.
    const wed = 1_783_468_800; // 2026-07-08 00:00 UTC
    const start = bucketStart(wed, 604_800, 345_600);
    // Monday 2026-07-06 00:00 UTC = 1783296000
    expect(start).toBe(1_783_296_000);
    // A Monday maps to itself.
    expect(bucketStart(1_783_296_000, 604_800, 345_600)).toBe(1_783_296_000);
  });
});

describe('stepBucket', () => {
  const B = 1_000_000;

  it('tracks but does not own a bucket joined mid-flight', () => {
    const r = stepBucket(undefined, B, 100n);
    expect(r.state.owned).toBe(false);
    expect(r.closed).toBeNull();
  });

  it('updates high/low/close within the same bucket', () => {
    let s: BucketState = stepBucket(undefined, B, 100n).state;
    s = { ...s, owned: true }; // pretend we own it
    const up = stepBucket(s, B, 120n);
    expect(up.state.open).toBe(100n);
    expect(up.state.high).toBe(120n);
    expect(up.state.low).toBe(100n);
    expect(up.state.close).toBe(120n);
    const down = stepBucket(up.state, B, 90n);
    expect(down.state.high).toBe(120n);
    expect(down.state.low).toBe(90n);
    expect(down.state.close).toBe(90n);
    expect(down.closed).toBeNull();
  });

  it('emits the closed candle on rollover of an owned bucket', () => {
    let s = stepBucket(undefined, B, 100n).state;
    s = stepBucket({ ...s, owned: true }, B, 130n).state; // own + high
    s = stepBucket(s, B, 95n).state; // low + close
    const roll = stepBucket(s, B + 60, 96n);
    expect(roll.closed).toEqual({ bucketTs: B, open: 100n, high: 130n, low: 95n, close: 95n });
    expect(roll.state.bucket).toBe(B + 60);
    expect(roll.state.open).toBe(96n);
    expect(roll.state.owned).toBe(true);
  });

  it('does not emit a closed candle when rolling over an unowned startup bucket', () => {
    const s = stepBucket(undefined, B, 100n).state; // owned=false
    const roll = stepBucket(s, B + 60, 105n);
    expect(roll.closed).toBeNull();
    expect(roll.state.owned).toBe(true); // now owns the fresh bucket
  });

  it('ignores out-of-order observations', () => {
    const s = stepBucket({ ...stepBucket(undefined, B, 100n).state, owned: true }, B, 110n).state;
    const stale = stepBucket(s, B - 60, 999n);
    expect(stale.state).toBe(s);
    expect(stale.closed).toBeNull();
  });
});
