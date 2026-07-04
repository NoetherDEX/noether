import type { Transport } from '../transport.js';

export interface OpenPositionRow {
  positionId: number;
  trader: string;
  asset: string;
  direction: number;
  size: string;
  entryPrice: string;
  openedAt: number;
  openedTxHash: string;
}

export interface OpenPositionsQuery {
  trader?: string;
}

export class PositionsApi {
  constructor(private readonly transport: Transport) {}

  /** Public — currently open positions, optionally filtered by trader. */
  async open(query: OpenPositionsQuery = {}): Promise<OpenPositionRow[]> {
    const res = await this.transport.request<{ positions: OpenPositionRow[] }>({
      path: '/v1/positions/open',
      query: { trader: query.trader },
    });
    return res.positions;
  }
}
