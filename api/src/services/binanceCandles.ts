/**
 * Binance reference candles — the fallback for /v1/candles when the venue has
 * no native Noeracle candles yet for an (asset, interval) (cold start, or the
 * indexer aggregator isn't running). Native DB candles are always preferred;
 * this only fills genuinely-empty results so the chart is never blank.
 */

import type { CandlePoint } from './stats.js';

// Multiple endpoints because Binance geo-blocks some regions (mirrors the web
// price proxy + the indexer seed). 451/403 → try the next base.
const BINANCE_BASES = [
  'https://api.binance.us/api/v3',
  'https://api4.binance.com/api/v3',
  'https://api1.binance.com/api/v3',
  'https://api.binance.com/api/v3',
];

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

export async function fetchBinanceCandles(
  asset: string,
  interval: string,
  limit: number,
): Promise<CandlePoint[]> {
  const pair = BINANCE_PAIRS[asset];
  if (!pair) return [];
  const path = `/klines?symbol=${pair}&interval=${interval}&limit=${limit}`;

  for (const base of BINANCE_BASES) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: ctrl.signal,
      });
      if (res.status === 451 || res.status === 403) continue; // geo-blocked
      if (!res.ok) continue;
      const data = (await res.json()) as (string | number)[][];
      return data.map((k) => ({
        time: Math.floor(Number(k[0]) / 1000),
        open: parseFloat(String(k[1])),
        high: parseFloat(String(k[2])),
        low: parseFloat(String(k[3])),
        close: parseFloat(String(k[4])),
      }));
    } catch {
      // try the next endpoint
    } finally {
      clearTimeout(timer);
    }
  }
  return [];
}
