import type { Candle, Ticker } from '@/types';

// Asset symbol mapping to Binance pairs
const BINANCE_SYMBOLS: Record<string, string> = {
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
  PUMP: 'PUMPUSDT',
  UNI: 'UNIUSDT',
  // Tokenized gold — reachable once the pairs enter ASSETS (~2026-09-08).
  PAXG: 'PAXGUSDT',
  XAUT: 'XAUTUSDT',
};

/**
 * Fetch OHLCV candle data via server-side proxy (avoids Binance geo-blocks)
 */
export async function fetchCandles(
  asset: string,
  interval: string = '1h',
  limit: number = 500
): Promise<Candle[]> {
  const symbol = BINANCE_SYMBOLS[asset];
  if (!symbol) {
    throw new Error(`Unknown asset: ${asset}`);
  }

  const url = `/api/price?endpoint=klines&symbol=${symbol}&interval=${interval}&limit=${limit}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch candles');
  }

  const data = await response.json();

  // Binance klines format: [openTime, open, high, low, close, volume, closeTime, ...]
  return data.map((k: (string | number)[]) => ({
    time: Math.floor(Number(k[0]) / 1000), // Convert to seconds
    open: parseFloat(k[1] as string),
    high: parseFloat(k[2] as string),
    low: parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
  }));
}

/**
 * Fetch current ticker price via server-side proxy
 */
export async function fetchTicker(asset: string): Promise<Ticker> {
  const symbol = BINANCE_SYMBOLS[asset];
  if (!symbol) {
    throw new Error(`Unknown asset: ${asset}`);
  }

  const url = `/api/price?endpoint=ticker&symbol=${symbol}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch ticker');
  }

  const data = await response.json();

  return {
    symbol: asset,
    price: parseFloat(data.lastPrice),
    change24h: parseFloat(data.priceChange),
    changePercent24h: parseFloat(data.priceChangePercent),
    high24h: parseFloat(data.highPrice),
    low24h: parseFloat(data.lowPrice),
    volume24h: parseFloat(data.quoteVolume),
  };
}

/**
 * Fetch multiple tickers at once
 */
export async function fetchAllTickers(): Promise<Record<string, Ticker>> {
  const symbols = Object.entries(BINANCE_SYMBOLS);
  const tickers: Record<string, Ticker> = {};

  await Promise.all(
    symbols.map(async ([asset, _]) => {
      try {
        tickers[asset] = await fetchTicker(asset);
      } catch (error) {
        console.error(`Failed to fetch ${asset} ticker:`, error);
      }
    })
  );

  return tickers;
}

/**
 * Subscribe to real-time price updates via polling (WebSocket blocked by geo-restrictions)
 */
export function subscribeToPriceUpdates(
  asset: string,
  onUpdate: (price: number) => void
): () => void {
  let active = true;

  const poll = async () => {
    while (active) {
      try {
        const ticker = await fetchTicker(asset);
        if (active) onUpdate(ticker.price);
      } catch {
        // Silently retry
      }
      await new Promise(r => setTimeout(r, 5000)); // Poll every 5s
    }
  };

  poll();

  return () => { active = false; };
}

/**
 * Map interval string to Binance format
 */
export function toBinanceInterval(interval: string): string {
  const mapping: Record<string, string> = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '1h': '1h',
    '4h': '4h',
    '1d': '1d',
    '1w': '1w',
  };

  return mapping[interval] || '1h';
}
