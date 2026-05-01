import type { Client } from '@libsql/client';
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
 * libsql-backed fixed-window counter.
 * For each (bucket, window_start_seconds) pair we maintain a count.
 * Rejects when count > tier.perMinute.
 */
export class RateLimiter {
  constructor(private readonly db: Client) {}

  async checkAndConsume(bucket: string, tier: RateLimitTier): Promise<RateLimitDecision> {
    const limit = RATE_LIMIT_TIERS[tier].perMinute;
    const nowSec = Math.floor(Date.now() / 1000);
    const windowStart = nowSec - (nowSec % WINDOW_SEC);

    await this.db.execute({
      sql: `
        INSERT INTO rate_limit_buckets (key_id, window_start, count)
        VALUES (?, ?, 1)
        ON CONFLICT (key_id, window_start) DO UPDATE SET count = count + 1
      `,
      args: [bucket, windowStart],
    });

    const result = await this.db.execute({
      sql: 'SELECT count FROM rate_limit_buckets WHERE key_id = ? AND window_start = ?',
      args: [bucket, windowStart],
    });
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
}
