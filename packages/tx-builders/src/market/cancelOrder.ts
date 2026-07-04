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

const METHOD = 'cancel_order';

export interface CancelOrderParams {
  trader: StellarAddress;
  orderId: number | bigint;
}

export function buildCancelOrderArgs(params: CancelOrderParams): xdr.ScVal[] {
  return [
    toScVal(params.trader, 'address'),
    toScVal(params.orderId, 'u64'),
  ];
}

export function buildCancelOrderOp(marketContractId: string, params: CancelOrderParams): InvokeOp {
  return buildInvokeOp(marketContractId, METHOD, buildCancelOrderArgs(params));
}

export async function buildCancelOrderTx(
  ctx: TxBuildContext,
  marketContractId: string,
  params: CancelOrderParams,
): Promise<PreparedTx> {
  return buildContractTx(ctx, params.trader, marketContractId, METHOD, buildCancelOrderArgs(params));
}
