/**
 * Trading endpoints — Phase 5 v0.
 *
 * The owner of the API key is bound as the `trader` for every prepared
 * transaction. The client cannot prepare a tx for another address.
 * Submission is a separate endpoint (POST /v1/tx/submit) so the client
 * can sign locally between the two calls.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  buildOpenPositionTx,
  buildClosePositionTx,
  buildPlaceLimitOrderTx,
  buildCancelOrderTx,
} from '@noether/tx-builders/market';
import type { TxBuildContext, PreparedTx } from '@noether/tx-builders';
import { isSupportedAsset } from '@noether/shared';

interface OpenPositionBody {
  op: 'open_position';
  asset: string;
  collateral: string;
  leverage: number;
  direction: 'Long' | 'Short';
}

interface ClosePositionBody {
  op: 'close_position';
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

interface CancelOrderBody {
  op: 'cancel_order';
  orderId: number | string;
}

type PrepareBody = OpenPositionBody | ClosePositionBody | PlaceLimitOrderBody | CancelOrderBody;

const PREPARE_BODY_SCHEMA = {
  type: 'object',
  required: ['op'],
  oneOf: [
    {
      type: 'object',
      required: ['op', 'asset', 'collateral', 'leverage', 'direction'],
      properties: {
        op: { const: 'open_position' },
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
        op: { const: 'close_position' },
        positionId: { type: ['integer', 'string'] },
      },
    },
    {
      type: 'object',
      required: [
        'op',
        'asset',
        'direction',
        'collateral',
        'leverage',
        'triggerPrice',
        'triggerCondition',
        'slippageToleranceBps',
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
  /** Override builders for testing — same shapes as the real ones. */
  builders?: {
    openPosition: typeof buildOpenPositionTx;
    closePosition: typeof buildClosePositionTx;
    placeLimitOrder: typeof buildPlaceLimitOrderTx;
    cancelOrder: typeof buildCancelOrderTx;
  };
}

export async function registerOrderRoutes(app: FastifyInstance, deps: OrdersRouteDeps): Promise<void> {
  const builders = deps.builders ?? {
    openPosition: buildOpenPositionTx,
    closePosition: buildClosePositionTx,
    placeLimitOrder: buildPlaceLimitOrderTx,
    cancelOrder: buildCancelOrderTx,
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
        let prepared: PreparedTx;
        switch (body.op) {
          case 'open_position': {
            if (!isSupportedAsset(body.asset)) {
              return reply.code(400).send({ error: 'unsupported_asset', asset: body.asset });
            }
            prepared = await builders.openPosition(deps.txCtx, deps.marketContractId, {
              trader,
              asset: body.asset,
              collateral: BigInt(body.collateral),
              leverage: body.leverage,
              direction: body.direction,
            });
            break;
          }
          case 'close_position': {
            prepared = await builders.closePosition(deps.txCtx, deps.marketContractId, {
              trader,
              positionId: typeof body.positionId === 'string' ? BigInt(body.positionId) : body.positionId,
            });
            break;
          }
          case 'place_limit_order': {
            if (!isSupportedAsset(body.asset)) {
              return reply.code(400).send({ error: 'unsupported_asset', asset: body.asset });
            }
            prepared = await builders.placeLimitOrder(deps.txCtx, deps.marketContractId, {
              trader,
              asset: body.asset,
              direction: body.direction,
              collateral: BigInt(body.collateral),
              leverage: body.leverage,
              triggerPrice: BigInt(body.triggerPrice),
              triggerCondition: body.triggerCondition,
              slippageToleranceBps: body.slippageToleranceBps,
            });
            break;
          }
          case 'cancel_order': {
            prepared = await builders.cancelOrder(deps.txCtx, deps.marketContractId, {
              trader,
              orderId: typeof body.orderId === 'string' ? BigInt(body.orderId) : body.orderId,
            });
            break;
          }
          default: {
            const exhaustive: never = body;
            return reply.code(400).send({ error: 'unknown_op', op: (exhaustive as { op?: string }).op });
          }
        }

        return reply.send({
          op: body.op,
          trader,
          xdr: prepared.xdr,
          minResourceFee: prepared.simulation.minResourceFee?.toString(),
        });
      } catch (err: unknown) {
        return mapPrepareError(err, reply);
      }
    },
  );
}

function mapPrepareError(err: unknown, reply: FastifyReply): FastifyReply {
  const message = err instanceof Error ? err.message : String(err);
  // Surface simulation failures with a 400 (client supplied bad params /
  // contract rejected) and other unknowns as 502 (RPC outage etc).
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'TxSimulationError') {
    return reply.code(400).send({ error: 'simulation_failed', message });
  }
  reply.log.error({ err }, 'orders/prepare failed');
  return reply.code(502).send({ error: 'rpc_error', message });
}
