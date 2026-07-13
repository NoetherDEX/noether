import {
  CrosshairMode,
  LineStyle,
  type ChartOptions,
  type DeepPartial,
} from 'lightweight-charts';

/**
 * Quiet-terminal chart palette. Gold is the venue accent (--stellar-gold,
 * #eab308) and is reserved for the live Noeracle mark line so it reads as
 * "the price the protocol executes at" — distinct from the Binance candles.
 * Everything else stays on the token ramp: long/short greens/reds, neutral
 * foreground line series, hairline grid/axis.
 */
export const CHART_COLORS = {
  gold: '#eab308',
  goldDim: 'rgba(234, 179, 8, 0.45)',
  up: '#16C784',
  down: '#EA3943',
  liq: '#EA3943',
  entry: '#E8EAED',
  orderLong: '#16C784',
  orderShort: '#EA3943',
  line: '#E8EAED',
  areaTop: 'rgba(232, 234, 237, 0.08)',
  areaBottom: 'rgba(232, 234, 237, 0)',
  text: '#9BA1A8',
  grid: 'rgba(255, 255, 255, 0.04)',
  crosshair: 'rgba(255, 255, 255, 0.2)',
  crosshairLabelBg: '#1D222A',
  border: 'rgba(255, 255, 255, 0.07)',
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
