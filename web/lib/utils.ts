import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Re-export all utility functions from format.ts
export {
  formatUSD,
  formatNumber,
  formatPercent,
  bpsToPercent,
  fromPrecision,
  toPrecision,
  truncateAddress,
  formatRelativeTime,
  formatDateTime,
  shortenTxHash,
  calculateLiquidationPrice,
  calculatePnL,
} from './utils/format';
