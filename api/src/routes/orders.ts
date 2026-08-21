/**
 * Trading endpoints — Phase 5 + 5.1.
 *
 * The owner of the API key is bound as the `trader` for every prepared
 * transaction. The client cannot prepare a tx for another address.
 * Submission is a separate endpoint (POST /v1/tx/submit) so the client
 * can sign locally between the two calls.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  buildOpenPositionTx,
  buildClosePositionTx,
  buildPlaceLimitOrderTx,
  buildCancelOrderTx,
  buildOpenPositionCrossTx,
  buildClosePositionCrossTx,
  buildPlaceStopLimitOrderTx,
  buildPlaceTrailingStopTx,
  buildSetStopLossTx,
  buildSetTakeProfitTx,
} from '@noether/tx-builders/market';
import type { TxBuildContext, PreparedTx } from '@noether/tx-builders';
import { isSupportedAsset } from '@noether/shared';
import type { StatsService } from '../services/stats.js';

interface OpenPositionBody {
  op: 'open_position' | 'open_position_cross';
  asset: string;
  collateral: string;
  leverage: number;
  direction: 'Long' | 'Short';
}

interface ClosePositionBody {
  op: 'close_position' | 'close_position_cross';
  positionId: number | string;
}

interface PlaceLimitOrderBody {
  op: 'place_limit_order';
  asset: string;
  direction: 'Long' | 'Short';
  collateral: string;
  leverage: number;
  triggerPrice: string;
  triggerCondition: 'Above' | 'Below';
  slippageToleranceBps: number;
  /** 0=GTC (default), 1=IOC, 2=PostOnly. */
  timeInForce?: number;
  reduceOnly?: boolean;
}

interface PlaceStopLimitOrderBody {
  op: 'place_stop_limit_order';
  asset: string;
  direction: 'Long' | 'Short';
  collateral: string;
  leverage: number;
  triggerPrice: string;
  limitPrice: string;
  triggerCondition: 'Above' | 'Below';
  slippageToleranceBps: number;
  /** 0=GTC (default), 1=IOC, 2=PostOnly. */
  timeInForce?: number;
  reduceOnly?: boolean;
}

interface PlaceTrailingStopBody {
  op: 'place_trailing_stop';
  positionId: number | string;
  trailingPercentBps: number;
  slippageToleranceBps: number;
}

interface SetStopLossBody {
  op: 'set_stop_loss';
  positionId: number | string;
  triggerPrice: string;
  slippageToleranceBps: number;
}

interface SetTakeProfitBody {
  op: 'set_take_profit';
  positionId: number | string;
  triggerPrice: string;
  slippageToleranceBps: number;
  /** Optional take-limit price (7-decimal string); omit or "0" for a plain take-profit. */
  limitPrice?: string;
}

interface CancelOrderBody {
  op: 'cancel_order';
  orderId: number | string;
}

type PrepareBody =
  | OpenPositionBody
  | ClosePositionBody
  | PlaceLimitOrderBody
  | PlaceStopLimitOrderBody
  | PlaceTrailingStopBody
  | SetStopLossBody
  | SetTakeProfitBody
  | CancelOrderBody;

const PREPARE_BODY_SCHEMA = {
  type: 'object',
  required: ['op'],
  oneOf: [
    {
      type: 'object',
      required: ['op', 'asset', 'collateral', 'leverage', 'direction'],
      properties: {
        op: { enum: ['open_position', 'open_position_cross'] },
        asset: { type: 'string', minLength: 1, maxLength: 12 },
        collateral: { type: 'string', pattern: '^[0-9]+$' },
        leverage: { type: 'integer', minimum: 1, maximum: 10 },
        direction: { type: 'string', enum: ['Long', 'Short'] },
      },
    },
    {
      type: 'object',
      required: ['op', 'positionId'],
      properties: {
        op: { enum: ['close_position', 'close_position_cross'] },
        positionId: { type: ['integer', 'string'] },
      },
    },
    {
      type: 'object',
      required: [
        'op', 'asset', 'direction', 'collateral', 'leverage',
        'triggerPrice', 'triggerCondition', 'slippageToleranceBps',
      ],
      properties: {
        op: { const: 'place_limit_order' },
        asset: { type: 'string', minLength: 1, maxLength: 12 },
        direction: { type: 'string', enum: ['Long', 'Short'] },
        collateral: { type: 'string', pattern: '^[0-9]+$' },
        leverage: { type: 'integer', minimum: 1, maximum: 10 },
        triggerPrice: { type: 'string', pattern: '^[0-9]+$' },
        triggerCondition: { type: 'string', enum: ['Above', 'Below'] },
        slippageToleranceBps: { type: 'integer', minimum: 0, maximum: 10000 },
        timeInForce: { type: 'integer', enum: [0, 1, 2], description: '0=GTC (default), 1=IOC, 2=PostOnly' },
        reduceOnly: { type: 'boolean' },
      },
    },
    {
      type: 'object',
      required: [
        'op', 'asset', 'direction', 'collateral', 'leverage',
        'triggerPrice', 'limitPrice', 'triggerCondition', 'slippageToleranceBps',
      ],
      properties: {
        op: { const: 'place_stop_limit_order' },
        asset: { type: 'string', minLength: 1, maxLength: 12 },
        direction: { type: 'string', enum: ['Long', 'Short'] },
        collateral: { type: 'string', pattern: '^[0-9]+$' },
        leverage: { type: 'integer', minimum: 1, maximum: 10 },
        triggerPrice: { type: 'string', pattern: '^[0-9]+$' },
        limitPrice: { type: 'string', pattern: '^[0-9]+$' },
        triggerCondition: { type: 'string', enum: ['Above', 'Below'] },
        slippageToleranceBps: { type: 'integer', minimum: 0, maximum: 10000 },
        timeInForce: { type: 'integer', enum: [0, 1, 2], description: '0=GTC (default), 1=IOC, 2=PostOnly' },
        reduceOnly: { type: 'boolean' },
      },
    },
    {
      type: 'object',
      required: ['op', 'positionId', 'trailingPercentBps', 'slippageToleranceBps'],
      properties: {
        op: { const: 'place_trailing_stop' },
        positionId: { type: ['integer', 'string'] },
        trailingPercentBps: { type: 'integer', minimum: 1, maximum: 10000 },
        slippageToleranceBps: { type: 'integer', minimum: 0, maximum: 10000 },
      },
    },
    {
      type: 'object',
      required: ['op', 'positionId', 'triggerPrice', 'slippageToleranceBps'],
      properties: {
        op: { const: 'set_stop_loss' },
        positionId: { type: ['integer', 'string'] },
        triggerPrice: { type: 'string', pattern: '^[0-9]+$' },
        slippageToleranceBps: { type: 'integer', minimum: 0, maximum: 10000 },
      },
    },
    {
      type: 'object',
      required: ['op', 'positionId', 'triggerPrice', 'slippageToleranceBps'],
      properties: {
        op: { const: 'set_take_profit' },
        positionId: { type: ['integer', 'string'] },
        triggerPrice: { type: 'string', pattern: '^[0-9]+$' },
        slippageToleranceBps: { type: 'integer', minimum: 0, maximum: 10000 },
        limitPrice: {
          type: 'string',
          pattern: '^[0-9]+$',
          description: 'Optional take-limit price (7-decimal); omit or "0" for a plain take-profit',
        },
      },
    },
    {
      type: 'object',
      required: ['op', 'orderId'],
      properties: {
        op: { const: 'cancel_order' },
        orderId: { type: ['integer', 'string'] },
      },
    },
  ],
} as const;

export interface OrdersRouteDeps {
  txCtx: TxBuildContext;
  marketContractId: string;
  /** Override builders for testing. */
  builders?: {
    openPosition: typeof buildOpenPositionTx;
    closePosition: typeof buildClosePositionTx;
    placeLimitOrder: typeof buildPlaceLimitOrderTx;
    cancelOrder: typeof buildCancelOrderTx;
    openPositionCross?: typeof buildOpenPositionCrossTx;
    closePositionCross?: typeof buildClosePositionCrossTx;
    placeStopLimitOrder?: typeof buildPlaceStopLimitOrderTx;
    placeTrailingStop?: typeof buildPlaceTrailingStopTx;
    setStopLoss?: typeof buildSetStopLossTx;
    setTakeProfit?: typeof buildSetTakeProfitTx;
  };
}

interface OrdersOpenQuery {
  trader?: string;
  status?: 'open' | 'all';
  limit?: number;
}

const ORDER_EVENT_SCHEMA = {
  type: 'object',
  properties: {
    orderId: { type: 'integer' },
    trader: { type: 'string' },
    triggerPrice: { type: 'string' },
    status: { type: 'string', enum: ['open', 'executed', 'cancelled'] },
    ledger: { type: 'integer' },
    ts: { type: 'integer' },
    txHash: { type: 'string' },
  },
  required: ['orderId', 'trader', 'triggerPrice', 'status', 'ledger', 'ts', 'txHash'],
} as const;

export async function registerOrderRoutes(
  app: FastifyInstance,
  deps: OrdersRouteDeps,
  stats: StatsService,
): Promise<void> {
  // Public id-hint feed (no auth — mirrors /v1/positions/open). order_placed
  // events folded against order_executed / order_cancelled; detail
  // (asset, direction, size) is NOT here — clients hydrate per id on-chain.
  app.get<{ Querystring: OrdersOpenQuery }>(
    '/v1/orders/open',
    {
      schema: {
        description:
          'Orders placed on the current market, folded to open / executed / cancelled, newest first. ' +
          'order_placed events carry only (orderId, trader, triggerPrice) — hydrate detail on-chain ' +
          'via get_order for the ids returned. Default status=open; status=all includes resolved ' +
          'orders (order history). Use this to avoid iterating every on-chain order id.',
        tags: ['orders'],
        querystring: {
          type: 'object',
          properties: {
            trader: { type: 'string', minLength: 56, maxLength: 56 },
            status: { type: 'string', enum: ['open', 'all'] },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: { orders: { type: 'array', items: ORDER_EVENT_SCHEMA } },
            required: ['orders'],
          },
        },
      },
    },
    async (req, reply) => {
      const rows = await stats.listOrders({
        trader: req.query.trader?.trim() || undefined,
        status: req.query.status,
        limit: req.query.limit,
      });
      return reply.send({ orders: rows });
    },
  );

  const builders = {
    openPosition: deps.builders?.openPosition ?? buildOpenPositionTx,
    closePosition: deps.builders?.closePosition ?? buildClosePositionTx,
    placeLimitOrder: deps.builders?.placeLimitOrder ?? buildPlaceLimitOrderTx,
    cancelOrder: deps.builders?.cancelOrder ?? buildCancelOrderTx,
    openPositionCross: deps.builders?.openPositionCross ?? buildOpenPositionCrossTx,
    closePositionCross: deps.builders?.closePositionCross ?? buildClosePositionCrossTx,
    placeStopLimitOrder: deps.builders?.placeStopLimitOrder ?? buildPlaceStopLimitOrderTx,
    placeTrailingStop: deps.builders?.placeTrailingStop ?? buildPlaceTrailingStopTx,
    setStopLoss: deps.builders?.setStopLoss ?? buildSetStopLossTx,
    setTakeProfit: deps.builders?.setTakeProfit ?? buildSetTakeProfitTx,
  };

  app.post<{ Body: PrepareBody }>(
    '/v1/orders/prepare',
    {
      preHandler: app.requireAuth,
      schema: {
        description:
          'Build an unsigned, simulated, prepared Soroban transaction for the requested trading op. The trader is fixed to the authenticated key owner.',
        tags: ['orders', 'trading'],
        body: PREPARE_BODY_SCHEMA,
        response: {
          200: {
            type: 'object',
            properties: {
              op: { type: 'string' },
              trader: { type: 'string' },
              xdr: { type: 'string' },
              minResourceFee: { type: 'string' },
            },
            required: ['op', 'trader', 'xdr'],
          },
          400: {
            type: 'object',
            additionalProperties: true,
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['error'],
          },
          502: {
            type: 'object',
            additionalProperties: true,
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['error'],
          },
        },
      },
    },
    async (req, reply) => {
      const trader = req.user!.owner;
      const body = req.body;

      try {
        const prepared = await dispatch(body, trader, deps, builders);
        return reply.send({
          op: body.op,
          trader,
          xdr: prepared.xdr,
          minResourceFee: prepared.simulation.minResourceFee?.toString(),
        });
      } catch (err: unknown) {
        if (err instanceof BadRequest) {
          return reply.code(400).send({ error: err.code, ...err.detail });
        }
        return mapPrepareError(err, reply);
      }
    },
  );
}

class BadRequest extends Error {
  constructor(public readonly code: string, public readonly detail: Record<string, unknown> = {}) {
    super(code);
  }
}

async function dispatch(
  body: PrepareBody,
  trader: string,
  deps: OrdersRouteDeps,
  builders: Required<NonNullable<OrdersRouteDeps['builders']>>,
): Promise<PreparedTx> {
  const market = deps.marketContractId;
  switch (body.op) {
    case 'open_position':
    case 'open_position_cross': {
      if (!isSupportedAsset(body.asset)) throw new BadRequest('unsupported_asset', { asset: body.asset });
      const fn = body.op === 'open_position' ? builders.openPosition : builders.openPositionCross;
      return fn(deps.txCtx, market, {
        trader,
        asset: body.asset,
        collateral: BigInt(body.collateral),
        leverage: body.leverage,
        direction: body.direction,
      });
    }
    case 'close_position':
    case 'close_position_cross': {
      const fn = body.op === 'close_position' ? builders.closePosition : builders.closePositionCross;
      return fn(deps.txCtx, market, {
        trader,
        positionId: parseId(body.positionId),
      });
    }
    case 'place_limit_order': {
      if (!isSupportedAsset(body.asset)) throw new BadRequest('unsupported_asset', { asset: body.asset });
      return builders.placeLimitOrder(deps.txCtx, market, {
        trader,
        asset: body.asset,
        direction: body.direction,
        collateral: BigInt(body.collateral),
        leverage: body.leverage,
        triggerPrice: BigInt(body.triggerPrice),
        triggerCondition: body.triggerCondition,
        slippageToleranceBps: body.slippageToleranceBps,
        timeInForce: encodeTimeInForce(body.timeInForce, body.reduceOnly),
      });
    }
    case 'place_stop_limit_order': {
      if (!isSupportedAsset(body.asset)) throw new BadRequest('unsupported_asset', { asset: body.asset });
      return builders.placeStopLimitOrder(deps.txCtx, market, {
        trader,
        asset: body.asset,
        direction: body.direction,
        collateral: BigInt(body.collateral),
        leverage: body.leverage,
        triggerPrice: BigInt(body.triggerPrice),
        limitPrice: BigInt(body.limitPrice),
        triggerCondition: body.triggerCondition,
        slippageToleranceBps: body.slippageToleranceBps,
        timeInForce: encodeTimeInForce(body.timeInForce, body.reduceOnly),
      });
    }
    case 'place_trailing_stop': {
      return builders.placeTrailingStop(deps.txCtx, market, {
        trader,
        positionId: parseId(body.positionId),
        trailingPercentBps: body.trailingPercentBps,
        slippageToleranceBps: body.slippageToleranceBps,
      });
    }
    case 'set_stop_loss': {
      return builders.setStopLoss(deps.txCtx, market, {
        trader,
        positionId: parseId(body.positionId),
        triggerPrice: BigInt(body.triggerPrice),
        slippageToleranceBps: body.slippageToleranceBps,
      });
    }
    case 'set_take_profit': {
      return builders.setTakeProfit(deps.txCtx, market, {
        trader,
        positionId: parseId(body.positionId),
        triggerPrice: BigInt(body.triggerPrice),
        slippageToleranceBps: body.slippageToleranceBps,
        limitPrice: BigInt(body.limitPrice ?? '0'),
      });
    }
    case 'cancel_order': {
      return builders.cancelOrder(deps.txCtx, market, {
        trader,
        orderId: parseId(body.orderId),
      });
    }
    default: {
      const exhaustive: never = body;
      throw new BadRequest('unknown_op', { op: (exhaustive as { op?: string }).op });
    }
  }
}

function parseId(v: number | string | bigint): number | bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'string') return BigInt(v);
  return v;
}

/** Contract packing: bits 0-7 = TIF mode (0=GTC, 1=IOC, 2=PostOnly), bit 8 = reduce_only. */
function encodeTimeInForce(timeInForce: number | undefined, reduceOnly: boolean | undefined): number {
  return (timeInForce ?? 0) | (reduceOnly ? 0x100 : 0);
}

function mapPrepareError(err: unknown, reply: FastifyReply): FastifyReply {
  const message = err instanceof Error ? err.message : String(err);
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'TxSimulationError') {
    return reply.code(400).send({ error: 'simulation_failed', message });
  }
  // 5xx bodies stay opaque (upstream RPC errors can embed endpoint hosts or
  // credentialed URLs) — the full error is in the log line, keyed by the
  // x-request-id header every response already carries.
  reply.log.error({ err }, 'orders/prepare failed');
  return reply.code(502).send({ error: 'rpc_error', message: 'Upstream RPC request failed.' });
}
