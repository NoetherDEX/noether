import type { Credentials, Transport } from '../transport.js';
import type { Direction, TriggerCondition } from '../types/index.js';

export interface OpenPositionRequest {
  op: 'open_position' | 'open_position_cross';
  asset: string;
  collateral: bigint | string;
  leverage: number;
  direction: Direction;
}

export interface ClosePositionRequest {
  op: 'close_position' | 'close_position_cross';
  positionId: number | bigint | string;
}

export interface PlaceLimitOrderRequest {
  op: 'place_limit_order';
  asset: string;
  direction: Direction;
  collateral: bigint | string;
  leverage: number;
  triggerPrice: bigint | string;
  triggerCondition: TriggerCondition;
  slippageToleranceBps: number;
}

export interface PlaceStopLimitOrderRequest {
  op: 'place_stop_limit_order';
  asset: string;
  direction: Direction;
  collateral: bigint | string;
  leverage: number;
  triggerPrice: bigint | string;
  limitPrice: bigint | string;
  triggerCondition: TriggerCondition;
  slippageToleranceBps: number;
}

export interface PlaceTrailingStopRequest {
  op: 'place_trailing_stop';
  positionId: number | bigint | string;
  trailingPercentBps: number;
  slippageToleranceBps: number;
}

export interface SetStopOrTakeProfitRequest {
  op: 'set_stop_loss' | 'set_take_profit';
  positionId: number | bigint | string;
  triggerPrice: bigint | string;
  slippageToleranceBps: number;
}

export interface CancelOrderRequest {
  op: 'cancel_order';
  orderId: number | bigint | string;
}

export type PrepareRequest =
  | OpenPositionRequest
  | ClosePositionRequest
  | PlaceLimitOrderRequest
  | PlaceStopLimitOrderRequest
  | PlaceTrailingStopRequest
  | SetStopOrTakeProfitRequest
  | CancelOrderRequest;

export interface PreparedTransaction {
  op: PrepareRequest['op'];
  trader: string;
  xdr: string;
  minResourceFee?: string;
}

export type OrderEventStatus = 'open' | 'executed' | 'cancelled';

export interface OrderEventRow {
  orderId: number;
  trader: string;
  /** 7-dec trigger price as emitted by order_placed. */
  triggerPrice: string;
  status: OrderEventStatus;
  ledger: number;
  ts: number;
  txHash: string;
}

export interface OpenOrdersQuery {
  trader?: string;
  /** Default 'open'; 'all' includes executed/cancelled (order history). */
  status?: 'open' | 'all';
  limit?: number;
}

export class OrdersApi {
  constructor(private readonly transport: Transport, private readonly credentials: Credentials | null) {}

  /**
   * Public — orders folded to open/executed/cancelled from the indexer's
   * order_placed / order_executed / order_cancelled events, newest first.
   * Carries only (orderId, trader, triggerPrice, status); hydrate asset /
   * direction / size on-chain via get_order for the ids returned.
   */
  async open(query: OpenOrdersQuery = {}): Promise<OrderEventRow[]> {
    const res = await this.transport.request<{ orders: OrderEventRow[] }>({
      path: '/v1/orders/open',
      query: { trader: query.trader, status: query.status, limit: query.limit },
    });
    return res.orders;
  }

  async prepare(request: PrepareRequest): Promise<PreparedTransaction> {
    if (!this.credentials) throw new Error('orders.prepare requires an authenticated client');
    return this.transport.request<PreparedTransaction>({
      method: 'POST',
      path: '/v1/orders/prepare',
      body: serialiseRequest(request),
      credentials: this.credentials,
    });
  }
}

function serialiseRequest(req: PrepareRequest): Record<string, unknown> {
  switch (req.op) {
    case 'open_position':
    case 'open_position_cross':
      return {
        op: req.op,
        asset: req.asset,
        collateral: stringifyBig(req.collateral),
        leverage: req.leverage,
        direction: req.direction,
      };
    case 'close_position':
    case 'close_position_cross':
      return { op: req.op, positionId: stringifyBig(req.positionId) };
    case 'place_limit_order':
      return {
        op: 'place_limit_order',
        asset: req.asset,
        direction: req.direction,
        collateral: stringifyBig(req.collateral),
        leverage: req.leverage,
        triggerPrice: stringifyBig(req.triggerPrice),
        triggerCondition: req.triggerCondition,
        slippageToleranceBps: req.slippageToleranceBps,
      };
    case 'place_stop_limit_order':
      return {
        op: 'place_stop_limit_order',
        asset: req.asset,
        direction: req.direction,
        collateral: stringifyBig(req.collateral),
        leverage: req.leverage,
        triggerPrice: stringifyBig(req.triggerPrice),
        limitPrice: stringifyBig(req.limitPrice),
        triggerCondition: req.triggerCondition,
        slippageToleranceBps: req.slippageToleranceBps,
      };
    case 'place_trailing_stop':
      return {
        op: 'place_trailing_stop',
        positionId: stringifyBig(req.positionId),
        trailingPercentBps: req.trailingPercentBps,
        slippageToleranceBps: req.slippageToleranceBps,
      };
    case 'set_stop_loss':
    case 'set_take_profit':
      return {
        op: req.op,
        positionId: stringifyBig(req.positionId),
        triggerPrice: stringifyBig(req.triggerPrice),
        slippageToleranceBps: req.slippageToleranceBps,
      };
    case 'cancel_order':
      return { op: 'cancel_order', orderId: stringifyBig(req.orderId) };
  }
}

function stringifyBig(v: bigint | number | string): string {
  return typeof v === 'string' ? v : v.toString();
}
