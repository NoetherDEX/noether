import type { Direction, StellarAddress } from '@noether/types';
import type { xdr } from '@stellar/stellar-sdk';
import {
  buildContractTx,
  buildInvokeOp,
  type InvokeOp,
  type PreparedTx,
  type TxBuildContext,
} from '../client.js';
import { toScVal } from '../scval.js';

const METHOD = 'open_position';

export interface OpenPositionParams {
  trader: StellarAddress;
  asset: string;
  collateral: bigint;
  leverage: number;
  direction: Direction;
}

export function buildOpenPositionArgs(params: OpenPositionParams): xdr.ScVal[] {
  return [
    toScVal(params.trader, 'address'),
    toScVal(params.asset, 'symbol'),
    toScVal(params.collateral, 'i128'),
    toScVal(params.leverage, 'u32'),
    toScVal(params.direction, 'direction'),
  ];
}

export function buildOpenPositionOp(marketContractId: string, params: OpenPositionParams): InvokeOp {
  return buildInvokeOp(marketContractId, METHOD, buildOpenPositionArgs(params));
}

export async function buildOpenPositionTx(
  ctx: TxBuildContext,
  marketContractId: string,
  params: OpenPositionParams,
): Promise<PreparedTx> {
  return buildContractTx(ctx, params.trader, marketContractId, METHOD, buildOpenPositionArgs(params));
}
