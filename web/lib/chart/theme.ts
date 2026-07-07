import {
  CrosshairMode,
  LineStyle,
  type ChartOptions,
  type DeepPartial,
} from 'lightweight-charts';

/**
 * NOETHER brand chart palette. Gold is the venue accent (--stellar-gold,
 * #eab308) and is reserved for the live Noeracle mark line so it reads as
 * "the price the protocol executes at" — distinct from the Binance candles.
 */
export const CHART_COLORS = {
  gold: '#eab308',
  goldDim: 'rgba(234, 179, 8, 0.45)',
  up: '#10b981',
  down: '#ef4444',
  liq: '#f43f5e',
  entry: '#d4d4d8',
  order: '#3b82f6',
  text: '#71717a',
  grid: 'rgba(255, 255, 255, 0.03)',
  crosshair: 'rgba(255, 255, 255, 0.20)',
  crosshairLabelBg: '#27272a',
  border: 'rgba(255, 255, 255, 0.10)',
} as const;

/** Shared chart options — transparent over the app's near-black background. */
export const baseChartOptions: DeepPartial<ChartOptions> = {
  layout: {
    background: { color: 'transparent' },
    textColor: CHART_COLORS.text,
    fontFamily: 'var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, monospace',
  },
  // Pin axis/date formatting to en-US so the time scale doesn't render in the
  // browser locale next to en-US money values (A17).
  localization: { locale: 'en-US' },
  grid: {
    vertLines: { color: CHART_COLORS.grid },
    horzLines: { color: CHART_COLORS.grid },
  },
  crosshair: {
    mode: CrosshairMode.Magnet,
    vertLine: {
      color: CHART_COLORS.crosshair,
      labelBackgroundColor: CHART_COLORS.crosshairLabelBg,
      style: LineStyle.Dashed,
    },
    horzLine: {
      color: CHART_COLORS.crosshair,
      labelBackgroundColor: CHART_COLORS.crosshairLabelBg,
      style: LineStyle.Dashed,
    },
  },
  rightPriceScale: {
    borderColor: CHART_COLORS.border,
    scaleMargins: { top: 0.12, bottom: 0.12 },
  },
  timeScale: {
    borderColor: CHART_COLORS.border,
    timeVisible: true,
    secondsVisible: false,
  },
  handleScroll: { vertTouchDrag: false },
};
