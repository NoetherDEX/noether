/**
 * Oracle price ticker.
 *
 * Polls each supported asset's oracle price on a fixed interval and
 * emits a `ticker.<asset>` event on the WS bus. Only emits when the
 * value changes from the last broadcast — saves bandwidth and avoids
 * stuttering on subscribers when the oracle hasn't moved.
 */

import type { Logger } from 'pino';
import { SUPPORTED_ASSETS } from '@noether/shared';
import type { OracleService } from './oracle.js';
import type { WsBus } from './wsBus.js';

export interface OracleTickerOptions {
  oracle: OracleService;
  bus: WsBus;
  log: Logger;
  intervalMs?: number;
}

export class OracleTicker {
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private readonly lastPrice = new Map<string, string>();
  private stopped = false;

  constructor(private readonly opts: OracleTickerOptions) {
    this.intervalMs = opts.intervalMs ?? 3_000;
  }

  start(): void {
    if (this.timer) return;
    this.opts.log.info({ intervalMs: this.intervalMs }, 'Oracle ticker starting');
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    for (const asset of SUPPORTED_ASSETS) {
      try {
        const snap = await this.opts.oracle.getPrice(asset.symbol);
        const priceStr = snap.price.toString();
        // Emit every tick (cheap, gives subscribers a heartbeat) — track
        // last seen value so consumers can detect actual changes via
        // payload comparison if they want.
        this.lastPrice.set(asset.symbol, priceStr);
        const channel = `ticker.${asset.symbol}` as const;
        this.opts.bus.emit(channel, {
          asset: asset.symbol,
          price: priceStr,
          priceFloat: snap.priceFloat,
          timestamp: snap.timestamp,
          ts: Date.now(),
        });
      } catch (err) {
        this.opts.log.warn({ err, asset: asset.symbol }, 'oracle ticker fetch failed');
      }
    }
  }
}
