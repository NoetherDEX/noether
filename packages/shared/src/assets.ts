import type { Asset } from '@noether/types';

/**
 * Supported trading assets across the Noether ecosystem.
 * Mirrors web/lib/utils/constants.ts ASSETS so the API, indexer, frontend,
 * and SDK all agree on the symbol list.
 */
export const SUPPORTED_ASSETS: readonly Asset[] = [
  { symbol: 'BTC', name: 'Bitcoin', decimals: 8 },
  { symbol: 'ETH', name: 'Ethereum', decimals: 8 },
  { symbol: 'XLM', name: 'Stellar Lumens', decimals: 7 },
  { symbol: 'SOL', name: 'Solana', decimals: 7 },
  { symbol: 'XRP', name: 'XRP', decimals: 7 },
  { symbol: 'ADA', name: 'Cardano', decimals: 7 },
  { symbol: 'BNB', name: 'BNB', decimals: 7 },
  { symbol: 'TRX', name: 'Tron', decimals: 7 },
  // HYPE is protocol-supported (contracts + oracle + keeper) but not listed
  // in the web UI yet — Binance has no HYPEUSDT feed for the chart/candles.
  { symbol: 'HYPE', name: 'Hyperliquid', decimals: 7 },
  { symbol: 'DOGE', name: 'Dogecoin', decimals: 7 },
  { symbol: 'ZEC', name: 'Zcash', decimals: 7 },
  { symbol: 'LINK', name: 'Chainlink', decimals: 7 },
  { symbol: 'BCH', name: 'Bitcoin Cash', decimals: 7 },
  { symbol: 'LTC', name: 'Litecoin', decimals: 7 },
] as const;

export const SUPPORTED_ASSET_SYMBOLS: readonly string[] = SUPPORTED_ASSETS.map(
  (a) => a.symbol,
);

export function isSupportedAsset(symbol: string): boolean {
  return SUPPORTED_ASSET_SYMBOLS.includes(symbol);
}

export function getAsset(symbol: string): Asset | undefined {
  return SUPPORTED_ASSETS.find((a) => a.symbol === symbol);
}
