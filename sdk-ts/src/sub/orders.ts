import type { Credentials, Transport } from '../transport.js';
import type { Direction, TriggerCondition } from '@noether/types';

export interface OpenPositionRequest {
  op: 'open_position';
  asset: string;
  collateral: bigint | string;
  leverage: number;
  direction: Direction;
}

export interface ClosePositionRequest {
  op: 'close_position';
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

export interface CancelOrderRequest {
  op: 'cancel_order';
  orderId: number | bigint | string;
}

export type PrepareRequest =
  | OpenPositionRequest
  | ClosePositionRequest
  | PlaceLimitOrderRequest
  | CancelOrderRequest;

export interface PreparedTransaction {
  op: PrepareRequest['op'];
  trader: string;
  /** Base64 XDR ready for signing. */
  xdr: string;
  /** Soroban-suggested resource fee, decimal string. */
  minResourceFee?: string;
}

export class OrdersApi {
  constructor(private readonly transport: Transport, private readonly credentials: Credentials | null) {}

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
      return {
        op: 'open_position',
        asset: req.asset,
        collateral: stringifyBig(req.collateral),
        leverage: req.leverage,
        direction: req.direction,
      };
    case 'close_position':
      return { op: 'close_position', positionId: stringifyBig(req.positionId) };
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
    case 'cancel_order':
      return { op: 'cancel_order', orderId: stringifyBig(req.orderId) };
  }
}

function stringifyBig(v: bigint | number | string): string {
  return typeof v === 'string' ? v : v.toString();
}
