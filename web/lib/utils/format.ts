import { TRADING } from './constants';

/**
 * Format a number as USD currency
 */
export function formatUSD(value: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Format a number with commas
 */
export function formatNumber(value: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Format a percentage
 */
export function formatPercent(value: number, decimals = 2): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

/**
 * Format basis points to percentage
 */
export function bpsToPercent(bps: number): number {
  return bps / 100;
}

/**
 * Convert from contract precision (7 decimals) to display value
 */
export function fromPrecision(value: bigint | number): number {
  const num = typeof value === 'bigint' ? Number(value) : value;
  return num / TRADING.PRECISION;
}

/**
 * Convert from display value to contract precision (7 decimals)
 */
export function toPrecision(value: number): bigint {
  return BigInt(Math.floor(value * TRADING.PRECISION));
}

/**
 * Truncate a Stellar address for display
 */
export function truncateAddress(address: string, start = 4, end = 4): string {
  if (address.length <= start + end) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

/**
 * Format a timestamp as relative time
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/**
 * Calculate liquidation price
 */
export function calculateLiquidationPrice(
  entryPrice: number,
  leverage: number,
  isLong: boolean,
  maintenanceMarginBps = 100 // 1%
): number {
  const maintenanceMargin = maintenanceMarginBps / 10000;
  const moveToLiquidation = (1 / leverage) - maintenanceMargin;

  if (isLong) {
    return entryPrice * (1 - moveToLiquidation);
  } else {
    return entryPrice * (1 + moveToLiquidation);
  }
}

/**
 * Calculate position PnL
 */
export function calculatePnL(
  entryPrice: number,
  currentPrice: number,
  size: number,
  isLong: boolean
): { pnl: number; pnlPercent: number } {
  const priceChange = currentPrice - entryPrice;
  const pnl = isLong ? (priceChange / entryPrice) * size : (-priceChange / entryPrice) * size;
  const pnlPercent = (pnl / size) * 100;

  return { pnl, pnlPercent };
}
