import { TRADING } from './constants';

// House rule (money-display honesty): an unknown value is NEVER rendered as 0
// or a fabricated number. Every formatter here accepts null/undefined/NaN and
// returns an em dash '—' so callers can pass possibly-missing values through.
// For tabular alignment, pair these with Tailwind's built-in `tabular-nums`
// class (already in use, e.g. VaultTradeHistory) — Inter ships the tnum feature.
const EM_DASH = '—';

function isMissing(value: number | null | undefined): value is null | undefined {
  return value == null || !Number.isFinite(value);
}

/**
 * Format a number as USD currency. Locale pinned to en-US.
 * null/undefined/NaN → '—'.
 */
export function formatUSD(value: number | null | undefined, decimals = 2): string {
  if (isMissing(value)) return EM_DASH;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Compact USD for stat tiles: $1.2M, $890.0K, $42.00. Under $1000 shows
 * two decimals; K/M/B suffixes above. null/undefined/NaN → '—'.
 */
export function formatCompactUsd(value: number | null | undefined): string {
  if (isMissing(value)) return EM_DASH;
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

/**
 * Format a price with appropriate decimals based on magnitude.
 * Prices < $0.01 get 6 decimals, < $1 get 4 decimals, otherwise 2.
 * null/undefined/NaN → '—'. For known pairs prefer formatPairPrice.
 */
export function formatPrice(price: number | null | undefined): string {
  if (isMissing(price)) return EM_DASH;
  const abs = Math.abs(price);
  if (abs < 0.01) return formatUSD(price, 6);
  if (abs < 1) return formatUSD(price, 4);
  return formatUSD(price, 2);
}

/** Fixed display decimals per supported pair (pro-venue convention). */
const PAIR_PRICE_DECIMALS: Record<string, number> = {
  BTC: 2,
  ETH: 2,
  XLM: 4,
};

/**
 * Per-pair price formatter: BTC/ETH at 2dp, XLM at 4dp, unknown assets fall
 * back to magnitude-based decimals. Accepts 'BTC' or 'BTC-PERP' forms.
 * Returns a $-prefixed en-US string; null/undefined/NaN → '—'.
 */
export function formatPairPrice(asset: string, price: number | null | undefined): string {
  if (isMissing(price)) return EM_DASH;
  const key = asset.toUpperCase().replace(/-PERP$/, '');
  const decimals = PAIR_PRICE_DECIMALS[key];
  return decimals != null ? formatUSD(price, decimals) : formatPrice(price);
}

/**
 * Format a number with commas. Locale pinned to en-US.
 * null/undefined/NaN → '—'.
 * Migration note: `x.toLocaleString(undefined, { maximumFractionDigits: 0 })`
 * call-sites map to formatNumber(x, 0); bare `x.toLocaleString()` on integer
 * amounts maps to formatNumber(x, 0) as well.
 */
export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (isMissing(value)) return EM_DASH;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Format a percentage. This helper is the SINGLE owner of the sign:
 * positive → '+2.34%', negative → '-2.34%', values that round to zero →
 * neutral '0.00%' (no sign, no green-zero dressing). Callers must NOT
 * prepend their own '+' (the source of the '++2.34%' bug).
 * null/undefined/NaN → '—'.
 */
export function formatPercent(value: number | null | undefined, decimals = 2): string {
  if (isMissing(value)) return EM_DASH;
  const rounded = Number(value.toFixed(decimals));
  if (rounded === 0) return `${(0).toFixed(decimals)}%`;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(decimals)}%`;
}

// USDC contract precision as bigint (7 decimals), for exact i128 formatting.
const USDC_PRECISION_BI = BigInt(TRADING.PRECISION);

/**
 * THE shared 7-decimal USDC formatter (replaces the 7 divergent per-component
 * fmtUsdc copies — the VaultCard one corrupts negatives). Input is the RAW
 * contract amount (bigint, or an i128 decimal string from the indexer) — never
 * an already-scaled display number. Exact bigint math: sign-correct for
 * negatives, en-US thousands grouping, fraction TRUNCATED (not rounded) to
 * `decimals`. No '$' prefix — callers add '$' or ' USDC'.
 * null/undefined/unparseable → '—'.
 */
export function fmtUsdc7(raw: bigint | string | null | undefined, decimals = 2): string {
  if (raw == null) return EM_DASH;
  let value: bigint;
  try {
    value = typeof raw === 'bigint' ? raw : BigInt(raw);
  } catch {
    return EM_DASH;
  }
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / USDC_PRECISION_BI;
  const frac = abs % USDC_PRECISION_BI;
  const fracStr =
    decimals > 0 ? `.${frac.toString().padStart(7, '0').slice(0, decimals)}` : '';
  return `${negative ? '-' : ''}${whole.toLocaleString('en-US')}${fracStr}`;
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
 * Format a timestamp or Date as relative time (e.g., "2m ago", "1h ago")
 */
export function formatRelativeTime(input: number | Date): string {
  const timestamp = input instanceof Date ? input.getTime() : input;
  if (!timestamp || isNaN(timestamp)) return 'Unknown';

  const diff = Date.now() - timestamp;
  if (diff < 0 || diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/**
 * Format a Date object as "Jan 19, 14:30"
 */
export function formatDateTime(date: Date): string {
  if (!date || isNaN(date.getTime())) return 'Unknown';

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Normalize a Date / epoch-seconds / epoch-milliseconds input to a Date.
 * Numbers below 1e12 are treated as unix SECONDS (on-chain timestamps),
 * above as milliseconds — unambiguous for any date between 2001 and 33658,
 * and it removes the whole `* 1000` class of bugs at call sites.
 */
function toDate(input: Date | number | null | undefined): Date | null {
  if (input == null) return null;
  const date =
    input instanceof Date ? input : new Date(input < 1e12 ? input * 1000 : input);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Date only, locale pinned to en-US: "Jul 4, 2026".
 * Replaces browser-locale `.toLocaleDateString()` call-sites.
 * Accepts Date, epoch seconds, or epoch ms; invalid/missing → '—'.
 */
export function formatDate(input: Date | number | null | undefined): string {
  const date = toDate(input);
  if (!date) return EM_DASH;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Full date + time, locale pinned to en-US, 24h: "Jul 4, 2026, 14:30".
 * Replaces browser-locale `.toLocaleString()` datetime call-sites
 * (ApiKeysList, ReferralActivity, VaultActivity, VaultTradeHistory).
 * Accepts Date, epoch seconds, or epoch ms; invalid/missing → '—'.
 */
export function formatDateTimeFull(input: Date | number | null | undefined): string {
  const date = toDate(input);
  if (!date) return EM_DASH;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Shorten a transaction hash for display (e.g., "abc123...xyz789")
 */
export function shortenTxHash(hash: string, startChars = 6, endChars = 4): string {
  if (!hash) return '';
  if (hash.length <= startChars + endChars) return hash;
  return `${hash.slice(0, startChars)}...${hash.slice(-endChars)}`;
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
 * Calculate position PnL. NULL-SAFE: returns null when the current price is
 * unknown (null/undefined/NaN) or non-positive — a missing oracle read must
 * surface as '—', never as a fabricated −100% loss (0 means "no price", these
 * assets never trade at $0). Also null when entryPrice/size are degenerate,
 * so the division can never produce Infinity/NaN. Callers MUST handle null
 * by rendering '—' / keeping last-good with a stale badge.
 */
export function calculatePnL(
  entryPrice: number,
  currentPrice: number | null | undefined,
  size: number,
  isLong: boolean
): { pnl: number; pnlPercent: number } | null {
  if (currentPrice == null || !Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  if (!Number.isFinite(size) || size <= 0) return null;

  const priceChange = currentPrice - entryPrice;
  const pnl = isLong ? (priceChange / entryPrice) * size : (-priceChange / entryPrice) * size;
  const pnlPercent = (pnl / size) * 100;

  return { pnl, pnlPercent };
}
