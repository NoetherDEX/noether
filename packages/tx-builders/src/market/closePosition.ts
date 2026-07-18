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

const METHOD = 'close_position';

export interface ClosePositionParams {
  trader: StellarAddress;
  positionId: number | bigint;
}

export function buildClosePositionArgs(params: ClosePositionParams): xdr.ScVal[] {
  return [
    toScVal(params.trader, 'address'),
    toScVal(params.positionId, 'u64'),
  ];
}

export function buildClosePositionOp(marketContractId: string, params: ClosePositionParams): InvokeOp {
  return buildInvokeOp(marketContractId, METHOD, buildClosePositionArgs(params));
}

export async function buildClosePositionTx(
  ctx: TxBuildContext,
  marketContractId: string,
  params: ClosePositionParams,
): Promise<PreparedTx> {
  return buildContractTx(ctx, params.trader, marketContractId, METHOD, buildClosePositionArgs(params));
}
