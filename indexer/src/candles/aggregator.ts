/**
 * Native Noeracle candle aggregator.
 *
 * Polls the Noeracle attestation service (`/v1/latest`, all assets in one call)
 * and folds each price into per-(asset, interval) OHLC buckets. Closed buckets
 * are persisted to the `candles` table (written by the indexer, read by the api
 * via /v1/candles). History is seeded once from Binance so charts aren't empty
 * on a fresh DB; going forward the candles are the venue's own Noeracle marks.
 *
 * Volume is written as 0 (the venue's chart hides volume, and a price oracle has
 * none). The live/forming candle is built client-side from the SSE stream, so
 * this only needs to persist CLOSED candles — keeping writes to one per bucket.
 */

import type { Db } from '@noether/db';
import type { Logger } from 'pino';
import {
  CANDLE_INTERVALS,
  bucketStart,
  stepBucket,
  type BucketState,
  type CandleRow,
} from './bucketing.js';
import { hasBinancePair, seedFromBinance } from './seed.js';

interface LatestResponse {
  assets?: Record<string, { price?: string; timestamp?: number }>;
}

export interface CandleAggregatorStatus {
  enabled: boolean;
  seeded: boolean;
  writes: number;
  errors: number;
  lastPollOkAt: number | null;
  lastWriteAt: number | null;
  trackedAssets: number;
}

export interface CandleAggregatorOpts {
  db: Db;
  log: Logger;
  noeracleApiUrl: string;
  assets: string[];
  pollIntervalMs: number;
  seedBars: number;
}

const FETCH_TIMEOUT_MS = 8_000;

export class CandleAggregator {
  private readonly state = new Map<string, BucketState>();
  private running = false;
  private seeded = false;
  private writes = 0;
  private errors = 0;
  private lastPollOkAt: number | null = null;
  private lastWriteAt: number | null = null;

  constructor(private readonly opts: CandleAggregatorOpts) {}

  status(): CandleAggregatorStatus {
    return {
      enabled: true,
      seeded: this.seeded,
      writes: this.writes,
      errors: this.errors,
      lastPollOkAt: this.lastPollOkAt,
      lastWriteAt: this.lastWriteAt,
      trackedAssets: this.opts.assets.length,
    };
  }

  /** Seed history (best-effort), then run the live poll loop until stop(). */
  async start(): Promise<void> {
    this.running = true;
    try {
      await this.seed();
    } catch (err) {
      this.opts.log.warn({ err: (err as Error).message }, 'Candle seed failed (continuing live)');
    }
    this.seeded = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  private async seed(): Promise<void> {
    let total = 0;
    for (const asset of this.opts.assets) {
      if (!hasBinancePair(asset)) continue;
      for (const iv of CANDLE_INTERVALS) {
        try {
          total += await seedFromBinance(this.opts.db, asset, iv.name, this.opts.seedBars);
        } catch (err) {
          this.opts.log.warn(
            { asset, interval: iv.name, err: (err as Error).message },
            'Candle seed chunk failed',
          );
        }
      }
    }
    if (total > 0) this.opts.log.info({ inserted: total }, 'Candle history seeded from Binance');
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.poll();
        this.lastPollOkAt = Date.now();
      } catch (err) {
        this.errors += 1;
        this.opts.log.warn({ err: (err as Error).message }, 'Candle poll failed');
      }
      await sleep(this.opts.pollIntervalMs);
    }
  }

  private async poll(): Promise<void> {
    const latest = await this.fetchLatest();
    const assets = latest.assets ?? {};
    for (const asset of this.opts.assets) {
      const entry = assets[`${asset}/USD`];
      if (!entry?.price || entry.timestamp === undefined) continue;

      let price: bigint;
      try {
        price = BigInt(entry.price);
      } catch {
        continue;
      }
      if (price <= 0n) continue;

      const ts = Number(entry.timestamp);
      if (!Number.isFinite(ts) || ts <= 0) continue;

      for (const iv of CANDLE_INTERVALS) {
        const key = `${asset}:${iv.name}`;
        const bucket = bucketStart(ts, iv.sec, iv.offset);
        const res = stepBucket(this.state.get(key), bucket, price);
        this.state.set(key, res.state);
        if (res.closed) await this.writeClosed(asset, iv.name, res.closed);
      }
    }
  }

  private async writeClosed(asset: string, interval: string, c: CandleRow): Promise<void> {
    try {
      await this.opts.db.execute({
        sql: `INSERT INTO candles (asset, interval, bucket_ts, open, high, low, close, volume)
              VALUES (?, ?, ?, ?, ?, ?, ?, 0)
              ON CONFLICT(asset, interval, bucket_ts)
              DO UPDATE SET open = excluded.open, high = excluded.high,
                            low = excluded.low, close = excluded.close`,
        args: [asset, interval, c.bucketTs, c.open, c.high, c.low, c.close],
      });
      this.writes += 1;
      this.lastWriteAt = Date.now();
    } catch (err) {
      this.errors += 1;
      this.opts.log.warn({ asset, interval, err: (err as Error).message }, 'Candle write failed');
    }
  }

  private async fetchLatest(): Promise<LatestResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.opts.noeracleApiUrl}/v1/latest`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`Noeracle /v1/latest ${res.status}`);
      return (await res.json()) as LatestResponse;
    } finally {
      clearTimeout(timer);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
