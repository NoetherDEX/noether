'use client';

import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    TradingView?: { widget: new (options: Record<string, unknown>) => unknown };
  }
}

/* Binance spot feeds — every listed pair has a USDT market there. */
const SYMBOL_MAP: Record<string, string> = {
  BTC: 'BINANCE:BTCUSDT',
  ETH: 'BINANCE:ETHUSDT',
  XLM: 'BINANCE:XLMUSDT',
  SOL: 'BINANCE:SOLUSDT',
  XRP: 'BINANCE:XRPUSDT',
  ADA: 'BINANCE:ADAUSDT',
  BNB: 'BINANCE:BNBUSDT',
  TRX: 'BINANCE:TRXUSDT',
  DOGE: 'BINANCE:DOGEUSDT',
  ZEC: 'BINANCE:ZECUSDT',
  LINK: 'BINANCE:LINKUSDT',
  BCH: 'BINANCE:BCHUSDT',
  LTC: 'BINANCE:LTCUSDT',
};

const INTERVAL_MAP: Record<string, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
  '1w': 'W',
};

/* tv.js is loaded once and cached module-wide. */
let tvScript: Promise<void> | null = null;
function loadTv(): Promise<void> {
  if (typeof window !== 'undefined' && window.TradingView) return Promise.resolve();
  if (!tvScript) {
    tvScript = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://s3.tradingview.com/tv.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        tvScript = null;
        reject(new Error('tv.js failed to load'));
      };
      document.head.appendChild(s);
    });
  }
  return tvScript;
}

let containerSeq = 0;

interface TradingViewChartProps {
  asset: string;
  interval?: string;
}

/**
 * Full TradingView Advanced Chart (indicators, drawing toolbar, volume) for
 * the pro chart mode. Reference/analysis only — execution still settles at
 * the Noeracle mark, and position overlays live in the basic chart.
 */
export function TradingViewChart({ asset, interval = '1h' }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(`noether-tv-${++containerSeq}`);

  useEffect(() => {
    let cancelled = false;
    const el = containerRef.current;
    if (!el) return;

    loadTv()
      .then(() => {
        if (cancelled || !containerRef.current || !window.TradingView) return;
        containerRef.current.innerHTML = '';
        new window.TradingView.widget({
          container_id: idRef.current,
          autosize: true,
          symbol: SYMBOL_MAP[asset] ?? `BINANCE:${asset}USDT`,
          interval: INTERVAL_MAP[interval] ?? '60',
          timezone: 'Etc/UTC',
          theme: 'dark',
          style: '1',
          locale: 'en',
          backgroundColor: '#0B0D10',
          gridColor: 'rgba(255,255,255,0.04)',
          hide_top_toolbar: false,
          hide_side_toolbar: false,
          hide_legend: false,
          allow_symbol_change: false,
          withdateranges: true,
          save_image: true,
          studies: ['Volume@tv-basicstudies'],
        });
      })
      .catch(() => {
        /* offline / blocked — the basic chart mode remains available */
      });

    return () => {
      cancelled = true;
      if (el) el.innerHTML = '';
    };
  }, [asset, interval]);

  return <div id={idRef.current} ref={containerRef} className="w-full h-full" />;
}
