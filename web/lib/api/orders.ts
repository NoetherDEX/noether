/**
 * Order id-hints sourced from the indexer projection: order_placed events
 * folded against order_executed / order_cancelled on the gateway.
 *
 * Lets the Orders tab and the order book hydrate ONLY the ids that matter
 * (getOrdersByIds) instead of scanning every order id the market contract
 * has ever stored (the getOrders N+1 — KNOWN_ISSUES P-1). Detail (asset,
 * direction, size, live status) still comes from the chain per id — this
 * endpoint only narrows WHICH ids to read.
 */

import { apiBase } from './base';

export type OrderHintStatus = 'open' | 'executed' | 'cancelled';

export interface OrderHintRow {
  orderId: number;
  trader: string;
  /** 7-dec trigger price as emitted by order_placed. */
  triggerPrice: string;
  status: OrderHintStatus;
  ledger: number;
  ts: number;
  txHash: string;
}

export async function listOrderHints(
  opts: { trader?: string; status?: 'open' | 'all'; limit?: number } = {},
): Promise<OrderHintRow[]> {
  const params = new URLSearchParams();
  if (opts.trader) params.set('trader', opts.trader);
  if (opts.status) params.set('status', opts.status);
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const res = await fetch(`${apiBase()}/v1/orders/open${qs ? `?${qs}` : ''}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`orders api ${res.status}`);
  }
  const data = (await res.json()) as { orders: OrderHintRow[] };
  return data.orders;
}
