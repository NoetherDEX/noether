import type { StellarAddress } from '@noether/types';
import type { xdr } from '@stellar/stellar-sdk';
import {
  buildContractTx,
  buildInvokeOp,
  type InvokeOp,
  type PreparedTx,
  type TxBuildContext,
} from '../client.js';
import { toScVal } from '../scval.js';

export interface SetStopLossParams {
  trader: StellarAddress;
  positionId: number | bigint;
  triggerPrice: bigint;
  slippageToleranceBps: number;
}

export function buildSetStopLossArgs(params: SetStopLossParams): xdr.ScVal[] {
  return [
    toScVal(params.trader, 'address'),
    toScVal(params.positionId, 'u64'),
    toScVal(params.triggerPrice, 'i128'),
    toScVal(params.slippageToleranceBps, 'u32'),
  ];
}

export function buildSetStopLossOp(marketContractId: string, params: SetStopLossParams): InvokeOp {
  return buildInvokeOp(marketContractId, 'set_stop_loss', buildSetStopLossArgs(params));
}

export async function buildSetStopLossTx(
  ctx: TxBuildContext,
  marketContractId: string,
  params: SetStopLossParams,
): Promise<PreparedTx> {
  return buildContractTx(ctx, params.trader, marketContractId, 'set_stop_loss', buildSetStopLossArgs(params));
}

export interface SetTakeProfitParams {
  trader: StellarAddress;
  positionId: number | bigint;
  triggerPrice: bigint;
  slippageToleranceBps: number;
  /** Optional take-limit price; 0 = plain take-profit (market-style fill). */
  limitPrice?: bigint;
}

export function buildSetTakeProfitArgs(params: SetTakeProfitParams): xdr.ScVal[] {
  return [
    toScVal(params.trader, 'address'),
    toScVal(params.positionId, 'u64'),
    toScVal(params.triggerPrice, 'i128'),
    toScVal(params.slippageToleranceBps, 'u32'),
    toScVal(params.limitPrice ?? BigInt(0), 'i128'),
  ];
}

export function buildSetTakeProfitOp(marketContractId: string, params: SetTakeProfitParams): InvokeOp {
  return buildInvokeOp(marketContractId, 'set_take_profit', buildSetTakeProfitArgs(params));
}

export async function buildSetTakeProfitTx(
  ctx: TxBuildContext,
  marketContractId: string,
  params: SetTakeProfitParams,
): Promise<PreparedTx> {
  return buildContractTx(ctx, params.trader, marketContractId, 'set_take_profit', buildSetTakeProfitArgs(params));
}
