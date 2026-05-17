import type { Transport } from '../transport.js';

export interface HealthStatus {
  status: string;
  uptime: number;
  version: string;
}

export class HealthApi {
  constructor(private readonly transport: Transport) {}

  async ping(): Promise<HealthStatus> {
    return this.transport.request<HealthStatus>({ path: '/v1/health' });
  }
}
