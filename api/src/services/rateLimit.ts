import type { Db } from '@noether/db';
import type { KeyTier } from './apiKeys.js';

export type RateLimitTier = 'public' | KeyTier;

export interface RateLimitConfig {
  perMinute: number;
}

export const RATE_LIMIT_TIERS: Record<RateLimitTier, RateLimitConfig> = {
  public: { perMinute: 60 },
  standard: { perMinute: 600 },
  market_maker: { perMinute: 6000 },
};

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  windowStart: number;
}

const WINDOW_SEC = 60;

/**
 * Postgres-backed fixed-window counter.
 * For each (bucket, window_start_seconds) pair we maintain a count.
 * Rejects when count > tier.perMinute.
 */
export class RateLimiter {
  constructor(private readonly db: Db) {}

  async checkAndConsume(
    bucket: string,
    tier: RateLimitTier,
    overridePerMinute?: number,
  ): Promise<RateLimitDecision> {
    const limit = overridePerMinute ?? RATE_LIMIT_TIERS[tier].perMinute;
    const nowSec = Math.floor(Date.now() / 1000);
    const windowStart = nowSec - (nowSec % WINDOW_SEC);

    // Lazily ensure the table exists. The indexer normally creates it
    // via migration 001, but if the API is started against a fresh
    // empty DB (no indexer run yet) we shouldn't 500 the entire surface.
    await this.ensureTable();

    // Single statement: the upsert returns the post-increment value directly.
    // A separate SELECT would double the round trips per request and read a
    // value other concurrent requests may already have moved.
    const result = await this.db.execute({
      sql: `
        INSERT INTO rate_limit_buckets (key_id, window_start, count)
        VALUES (?, ?, 1)
        ON CONFLICT (key_id, window_start) DO UPDATE SET count = rate_limit_buckets.count + 1
        RETURNING count
      `,
      args: [bucket, windowStart],
    });
    // `count > limit` is intentional, not an off-by-one: count is 1 on the
    // first request, so requests 1..limit pass and limit+1 is the first to be
    // rejected — exactly `limit` per window.
    const count = Number(result.rows[0]?.count ?? 0);

    if (count > limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.max(1, windowStart + WINDOW_SEC - nowSec),
        windowStart,
      };
    }
    return {
      allowed: true,
      remaining: Math.max(0, limit - count),
      retryAfterSec: 0,
      windowStart,
    };
  }

  /** Delete counters from windows that have already elapsed. */
  async sweepExpired(): Promise<void> {
    const nowSec = Math.floor(Date.now() / 1000);
    const windowStart = nowSec - (nowSec % WINDOW_SEC);
    await this.ensureTable();
    await this.db.execute({
      sql: 'DELETE FROM rate_limit_buckets WHERE window_start < ?',
      args: [windowStart],
    });
  }

  private tableEnsured = false;

  private async ensureTable(): Promise<void> {
    if (this.tableEnsured) return;
    // Keep in sync with indexer/migrations/001_baseline.sql.
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS rate_limit_buckets (
        key_id        TEXT NOT NULL,
        window_start  BIGINT NOT NULL,
        count         BIGINT NOT NULL,
        PRIMARY KEY (key_id, window_start)
      );
    `);
    // Same for api_keys — auth middleware needs it on the same fresh DB.
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS api_keys (
        key_id        TEXT PRIMARY KEY,
        secret_hash   TEXT NOT NULL,
        owner         TEXT NOT NULL,
        tier          TEXT NOT NULL DEFAULT 'standard',
        label         TEXT,
        created_at    BIGINT NOT NULL,
        last_used_at  BIGINT,
        revoked_at    BIGINT
      );
    `);
    this.tableEnsured = true;
  }
}
