/**
 * One-time Binance history seed for a fresh candles table (the operator's
 * "seed once from Binance, native going forward" choice).
 *
 * ON CONFLICT DO NOTHING only fills MISSING buckets, so it never overwrites a candle
 * the aggregator has already written natively. We seed a given (asset, interval)
 * only when it has zero rows, so restarts don't re-fetch or clobber.
 */

import type { Db } from '@noether/db';

// Multiple endpoints because Binance geo-blocks some regions (mirrors the web
// price proxy). 451/403 → try the next base.
const BINANCE_BASES = [
  'https://api.binance.us/api/v3',
  'https://api4.binance.com/api/v3',
  'https://api1.binance.com/api/v3',
  'https://api.binance.com/api/v3',
];

// Noether symbol → Binance spot pair. HYPE is intentionally absent (no feed);
// it starts native-only and fills in as the aggregator runs.
const BINANCE_PAIRS: Record<string, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  XLM: 'XLMUSDT',
  SOL: 'SOLUSDT',
  XRP: 'XRPUSDT',
  ADA: 'ADAUSDT',
  BNB: 'BNBUSDT',
  TRX: 'TRXUSDT',
  DOGE: 'DOGEUSDT',
  ZEC: 'ZECUSDT',
  LINK: 'LINKUSDT',
  BCH: 'BCHUSDT',
  LTC: 'LTCUSDT',
};

const FETCH_TIMEOUT_MS = 8_000;
const SEED_CHUNK = 500;

export function hasBinancePair(asset: string): boolean {
  return asset in BINANCE_PAIRS;
}

/**
 * Seed a single (asset, interval) from Binance if the table has none yet.
 * Returns the number of bars inserted (0 if already seeded or no feed).
 */
export async function seedFromBinance(
  db: Db,
  asset: string,
  interval: string,
  limit: number,
): Promise<number> {
  const pair = BINANCE_PAIRS[asset];
  if (!pair) return 0;

  const existing = await db.execute({
    sql: 'SELECT COUNT(*) AS n FROM candles WHERE asset = ? AND interval = ?',
    args: [asset, interval],
  });
  if (Number(existing.rows[0]?.n ?? 0) > 0) return 0;

  const klines = await fetchKlines(pair, interval, limit);
  if (klines.length === 0) return 0;

  const stmts = klines.map((k) => ({
    sql: `INSERT INTO candles (asset, interval, bucket_ts, open, high, low, close, volume)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT (asset, interval, bucket_ts) DO NOTHING`,
    args: [asset, interval, k.bucketTs, k.open, k.high, k.low, k.close] as (string | number | bigint)[],
  }));
  for (let i = 0; i < stmts.length; i += SEED_CHUNK) {
    await db.batch(stmts.slice(i, i + SEED_CHUNK), 'write');
  }
  return stmts.length;
}

interface Kline {
  bucketTs: number;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
}

async function fetchKlines(pair: string, interval: string, limit: number): Promise<Kline[]> {
  const path = `/klines?symbol=${pair}&interval=${interval}&limit=${limit}`;
  let lastErr: unknown;
  for (const base of BINANCE_BASES) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: ctrl.signal,
      });
      if (res.status === 451 || res.status === 403) continue; // geo-blocked
      if (!res.ok) {
        lastErr = new Error(`Binance ${res.status}`);
        continue;
      }
      const data = (await res.json()) as (string | number)[][];
      return data
        .filter((k) => k.length >= 5)
        .map((k) => ({
          bucketTs: Math.floor(Number(k[0]!) / 1000),
          open: toScaled(k[1]!),
          high: toScaled(k[2]!),
          low: toScaled(k[3]!),
          close: toScaled(k[4]!),
        }));
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

/** Human price string/number → 7-decimal fixed-point bigint (Noether precision). */
function toScaled(v: string | number): bigint {
  return BigInt(Math.round(parseFloat(String(v)) * 1e7));
}
