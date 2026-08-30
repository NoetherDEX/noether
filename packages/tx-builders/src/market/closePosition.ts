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
  /** L0-10 worst-fill bound (7dp). Omitted or 0 = unbounded fill. */
  acceptablePrice?: bigint;
}

export function buildClosePositionArgs(params: ClosePositionParams): xdr.ScVal[] {
  return [
    toScVal(params.trader, 'address'),
    toScVal(params.positionId, 'u64'),
    toScVal(params.acceptablePrice ?? 0n, 'i128'),
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
  return buildContractTx(ctx, params.trader, marketContractId, METHOD, buildClosePositionArgs(params), {
    op: 'close',
    keyCtx: { positionId: BigInt(params.positionId) },
  });
}
