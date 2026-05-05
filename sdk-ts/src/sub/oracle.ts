import type { Transport } from '../transport.js';
import type { OracleSnapshot } from './markets.js';

export class OracleApi {
  constructor(private readonly transport: Transport) {}

  async getPrice(asset: string): Promise<OracleSnapshot> {
    return this.transport.request<OracleSnapshot>({ path: `/v1/markets/${asset.toUpperCase()}/price` });
  }

  async getPrices(): Promise<OracleSnapshot[]> {
    const res = await this.transport.request<{ prices: OracleSnapshot[] }>({ path: '/v1/oracle/prices' });
    return res.prices;
  }
}
