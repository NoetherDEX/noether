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
  /**
   * Advisory auto deleveraging quintile 1..5 (1 = first deleveraged);
   * null when the position is not queued or the queue is unavailable.
   * Served by GET /v1/positions/open; absent on the account positions
   * feed.
   */
  adlQuintile?: number | null;
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
