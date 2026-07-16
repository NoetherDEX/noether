/**
 * Trades feed sourced from the indexer projection (GET /v1/trades).
 *
 * One HTTPS call replaces the per-visit Horizon 100-tx meta-XDR parse
 * (Trade History) and the 3× getEvents scans (Recent Trades). Realized rows
 * carry asset/direction/size/entryPrice joined from their position_opened
 * event; `include_opens` adds kind:'open' rows; cross-margin account
 * liquidations arrive as kind:'cross_liquidation' with null position fields
 * (the chain emits one account-level event — pnl is the account total).
 *
 * Consumers gate on gatewayServesThisMarket() and keep their legacy
 * Horizon/getEvents paths as fallback — same trust pattern as positions
 * and orders.
 */

import { apiBase } from './base';
import { TRADING } from '@/lib/utils/constants';
import type { Trade } from '@/types';

export type TradeRowKind = 'open' | 'close' | 'liquidation' | 'cross_liquidation';

export interface TradeRow {
  /** Null for account-level rows (cross_liquidation has no position id). */
  positionId: number | null;
  trader: string;
  kind: TradeRowKind;
  asset: string | null;
  direction: number | null;
  size: string | null;
  entryPrice: string | null;
  closePrice: string | null;
  pnl: string | null;
  ledger: number;
  ts: number;
  txHash: string;
}

export async function listTrades(
  opts: {
    trader?: string;
    asset?: string;
    includeOpens?: boolean;
    beforeTs?: number;
    limit?: number;
  } = {},
): Promise<TradeRow[]> {
  const params = new URLSearchParams();
  if (opts.trader) params.set('trader', opts.trader);
  if (opts.asset) params.set('asset', opts.asset);
  if (opts.includeOpens) params.set('include_opens', 'true');
  if (opts.beforeTs !== undefined) params.set('before_ts', String(opts.beforeTs));
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const res = await fetch(`${apiBase()}/v1/trades${qs ? `?${qs}` : ''}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`trades api ${res.status}`);
  }
  const data = (await res.json()) as { trades: TradeRow[] };
  return data.trades;
}

const P = TRADING.PRECISION;
const toNum = (v: string | null): number | undefined =>
  v == null ? undefined : Number(v) / P;

/**
 * Gateway row → the web `Trade` shape the history UIs already render.
 * Field contract preserved from the Horizon/meta-XDR parser:
 *  - cross_liquidation → type 'liquidation' with asset 'CROSS', size/price 0,
 *    entryPrice undefined, pnl = account total (the existing isCrossLiq
 *    rendering keys off exactly that).
 *  - isolated liquidations keep pnl/entryPrice undefined when absent.
 *  - asset null (open predates indexer history — rare) renders as '—'.
 */
export function toTrade(row: TradeRow): Trade {
  const isCross = row.kind === 'cross_liquidation';
  return {
    id: row.positionId != null ? String(row.positionId) : `cross-${row.txHash}`,
    txHash: row.txHash,
    trader: row.trader,
    asset: isCross ? 'CROSS' : (row.asset ?? '—'),
    direction: row.direction === 1 ? 'Short' : 'Long',
    type: row.kind === 'open' ? 'open' : row.kind === 'close' ? 'close' : 'liquidation',
    size: toNum(row.size) ?? 0,
    price: (row.kind === 'open' ? toNum(row.entryPrice) : toNum(row.closePrice)) ?? 0,
    entryPrice: toNum(row.entryPrice),
    pnl: toNum(row.pnl),
    fee: undefined, // deployed events carry no fee — unknown renders '—'
    timestamp: new Date(row.ts * 1000),
  };
}
