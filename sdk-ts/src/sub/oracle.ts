import type { Transport } from '../transport.js';
import type { OracleSnapshot } from './markets.js';

/** Per asset entry of the oracle health report. Null fields mean the price read failed. */
export interface OracleAssetHealth {
  asset: string;
  priceFloat: number | null;
  ageSec: number | null;
  stale: boolean;
  error: string | null;
}

export interface OracleOnchainHealth {
  /** A price older than this many seconds counts as stale. */
  staleAfterSec: number;
  staleCount: number;
  assets: OracleAssetHealth[];
}

export interface OracleKeeperHealth {
  /** False when the gateway has no keeper heartbeat secret configured, so the keeper signal is unknown. */
  configured: boolean;
  ageMs: number | null;
  stale: boolean;
  lastReport: Record<string, unknown> | null;
}

export interface OracleHealth {
  status: 'ok' | 'degraded' | 'down';
  onchain: OracleOnchainHealth;
  keeper: OracleKeeperHealth;
}

export class OracleApi {
  constructor(private readonly transport: Transport) {}

  async getPrice(asset: string): Promise<OracleSnapshot> {
    return this.transport.request<OracleSnapshot>({ path: `/v1/markets/${asset.toUpperCase()}/price` });
  }

  async getPrices(): Promise<OracleSnapshot[]> {
    const res = await this.transport.request<{ prices: OracleSnapshot[] }>({ path: '/v1/oracle/prices' });
    return res.prices;
  }

  /**
   * Public. Per source oracle health: on chain price age per asset plus
   * the keeper's last self report. Check the `status` field. The
   * gateway's strict query flag (a 503 for uptime monitors when not ok)
   * is deliberately not exposed here; read `status` instead.
   */
  async health(): Promise<OracleHealth> {
    return this.transport.request<OracleHealth>({ path: '/v1/oracle/health' });
  }
}
