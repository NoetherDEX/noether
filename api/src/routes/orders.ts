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
}

interface PlaceTrailingStopBody {
  op: 'place_trailing_stop';
  positionId: number | string;
  trailingPercentBps: number;
  slippageToleranceBps: number;
}

interface SetStopOrTakeBody {
  op: 'set_stop_loss' | 'set_take_profit';
  positionId: number | string;
  triggerPrice: string;
  slippageToleranceBps: number;
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
  | SetStopOrTakeBody
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
        op: { enum: ['set_stop_loss', 'set_take_profit'] },
        positionId: { type: ['integer', 'string'] },
        triggerPrice: { type: 'string', pattern: '^[0-9]+$' },
        slippageToleranceBps: { type: 'integer', minimum: 0, maximum: 10000 },
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

export async function registerOrderRoutes(app: FastifyInstance, deps: OrdersRouteDeps): Promise<void> {
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
    case 'set_stop_loss':
    case 'set_take_profit': {
      const fn = body.op === 'set_stop_loss' ? builders.setStopLoss : builders.setTakeProfit;
      return fn(deps.txCtx, market, {
        trader,
        positionId: parseId(body.positionId),
        triggerPrice: BigInt(body.triggerPrice),
        slippageToleranceBps: body.slippageToleranceBps,
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

function mapPrepareError(err: unknown, reply: FastifyReply): FastifyReply {
  const message = err instanceof Error ? err.message : String(err);
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'TxSimulationError') {
    return reply.code(400).send({ error: 'simulation_failed', message });
  }
  reply.log.error({ err }, 'orders/prepare failed');
  return reply.code(502).send({ error: 'rpc_error', message });
}
