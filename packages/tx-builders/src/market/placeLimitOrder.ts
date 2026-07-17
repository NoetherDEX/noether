import type { Direction, StellarAddress, TriggerCondition } from '@noether/types';
import type { xdr } from '@stellar/stellar-sdk';
import {
  buildContractTx,
  buildInvokeOp,
  type InvokeOp,
  type PreparedTx,
  type TxBuildContext,
} from '../client.js';
import { toScVal } from '../scval.js';

const METHOD = 'place_limit_order';

export interface PlaceLimitOrderParams {
  trader: StellarAddress;
  asset: string;
  direction: Direction;
  collateral: bigint;
  leverage: number;
  triggerPrice: bigint;
  triggerCondition: TriggerCondition;
  slippageToleranceBps: number;
  /** Bits 0-7 = TIF mode (0=GTC, 1=IOC, 2=PostOnly), bit 8 = reduce_only. Defaults to 0 (GTC). */
  timeInForce?: number;
}

export function buildPlaceLimitOrderArgs(params: PlaceLimitOrderParams): xdr.ScVal[] {
  return [
    toScVal(params.trader, 'address'),
    toScVal(params.asset, 'symbol'),
    toScVal(params.direction, 'direction'),
    toScVal(params.collateral, 'i128'),
    toScVal(params.leverage, 'u32'),
    toScVal(params.triggerPrice, 'i128'),
    toScVal(params.triggerCondition, 'trigger_above'),
    toScVal(params.slippageToleranceBps, 'u32'),
    toScVal(params.timeInForce ?? 0, 'u32'),
  ];
}

export function buildPlaceLimitOrderOp(marketContractId: string, params: PlaceLimitOrderParams): InvokeOp {
  return buildInvokeOp(marketContractId, METHOD, buildPlaceLimitOrderArgs(params));
}

export async function buildPlaceLimitOrderTx(
  ctx: TxBuildContext,
  marketContractId: string,
  params: PlaceLimitOrderParams,
): Promise<PreparedTx> {
  return buildContractTx(ctx, params.trader, marketContractId, METHOD, buildPlaceLimitOrderArgs(params));
}
