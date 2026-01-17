// OHLCV candle data for charts
export interface Candle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// Chart timeframe
export interface Timeframe {
  label: string;
  value: string;
  seconds: number;
}

// Price ticker data
export interface Ticker {
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}
