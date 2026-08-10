import type { Transport } from '../transport.js';
import type { TradeKind } from '../types/index.js';

/**
 * One row from GET /v1/trades. Realized rows (close, liquidation, adl)
 * join asset, direction, size and entry price from the matching open
 * event; those fields are null when the open predates the indexer
 * history. Cross margin account liquidations carry null position fields
 * and the account total as pnl.
 */
export interface TradeRow {
  /** Null on account level rows (cross_liquidation carries no position id). */
  positionId: number | null;
  trader: string;
  kind: TradeKind;
  asset: string | null;
  direction: number | null;
  /** 7 decimal strings preserve i128 precision. */
  size: string | null;
  entryPrice: string | null;
  closePrice: string | null;
  pnl: string | null;
  ledger: number;
  ts: number;
  txHash: string;
}

export interface TradesQuery {
  trader?: string;
  asset?: string;
  /** Cursor: only rows with ts strictly below this unix time. */
  beforeTs?: number;
  /** Max 200; gateway default 50. */
  limit?: number;
  /** Also receive position_opened rows as kind 'open'. */
  includeOpens?: boolean;
}

export class TradesApi {
  constructor(private readonly transport: Transport) {}

  /**
   * Public. Recent trades, newest first. Page backwards by passing the
   * oldest row's `ts` as `beforeTs` on the next call.
   */
  async list(query: TradesQuery = {}): Promise<TradeRow[]> {
    const res = await this.transport.request<{ trades: TradeRow[] }>({
      path: '/v1/trades',
      query: {
        trader: query.trader,
        asset: query.asset?.toUpperCase(),
        before_ts: query.beforeTs,
        limit: query.limit,
        include_opens: query.includeOpens,
      },
    });
    return res.trades;
  }
}
