/**
 * OHLC candles from the Noether gateway (/v1/candles). Native Noeracle candles
 * when the venue has them; the gateway transparently falls back to Binance
 * reference candles otherwise — the `source` field says which. Throws on
 * transport/config failure so the caller can fall back to the direct Binance
 * proxy (keeps the chart alive even before the api route is deployed).
 */

import { apiBase } from './base';
import type { Candle } from '@/types';

export type CandleSource = 'noeracle' | 'binance';

export interface CandlesResult {
  candles: Candle[];
  source: CandleSource;
}

export async function getCandles(
  asset: string,
  interval: string,
  limit = 500,
): Promise<CandlesResult> {
  const url =
    `${apiBase()}/v1/candles?asset=${encodeURIComponent(asset)}` +
    `&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const res = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`candles ${res.status}`);
  const data = (await res.json()) as { candles?: Candle[]; source?: CandleSource };
  return { candles: data.candles ?? [], source: data.source ?? 'noeracle' };
}
