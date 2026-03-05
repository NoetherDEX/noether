import { toPng } from 'html-to-image';
import type { PnlShareData } from '@/types';
import { formatUSD, formatPercent } from './format';

export async function downloadPnlImage(
  element: HTMLElement,
  asset: string,
  direction: string
): Promise<void> {
  const dataUrl = await toPng(element, {
    pixelRatio: 2,
    backgroundColor: '#0a0a0c',
  });

  const timestamp = Date.now();
  const filename = `noether-${asset}-${direction.toLowerCase()}-${timestamp}.png`;

  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

export function shareToTwitter(data: PnlShareData): void {
  const pnlStr = formatUSD(data.pnl);
  const pnlPctStr = formatPercent(data.pnlPercent);
  const sign = data.pnl >= 0 ? '+' : '';
  const leverageStr = data.leverage ? ` ${data.leverage}x` : '';

  const text = `${data.direction} ${data.asset}-PERP${leverageStr} | PnL: ${sign}${pnlStr} (${sign}${pnlPctStr}) on @NoetherTrade`;

  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
